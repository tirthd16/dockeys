// Google Docs has moved from using editable HTML elements (textbox with contenteditable=true)
// to custom implementation with its own editing surface since 2015. (https://drive.googleblog.com/2010/05/whats-different-about-new-google-docs.html)
// This means that each keystroke is captured and then fed into layout engine which 
// then draws the text, cursor, selection, headings etc on seperate iframe.
// Such implementation deters any extensibility in terms of text manipulation because 
// there is no API to interact with Google Docs layout engine

// Thus only way (in my understanding) to achieve vim motions would be to capture keystrokes
// before sending to layout engine and interpret them into respective vim motion/command.
// Then implement those motions by sending relevant keystrokes. Essentially doing a keystroke to keystroke remapping. 

const iframe = document.getElementsByTagName('iframe')[0]   // https://stackoverflow.com/a/4388829
iframe.contentDocument.addEventListener('keydown', eventHandler, true)

const cursorTop = document.getElementsByClassName("kix-cursor-top")[0] // element to edit to show normal vs insert mode
let mode = 'normal'
let tempnormal = false // State variable for indicating temperory normal mode
let multipleMotion = {
    times:0,
    mode:"normal"
}

let pendingSearch = null

// How to simulate a keypress in Chrome: http://stackoverflow.com/a/10520017/46237
// Note that we have to do this keypress simulation in an injected script, because events dispatched
// by content scripts do not preserve overridden properties.
const script = document.createElement("script");
script.src = chrome.runtime.getURL("page_script.js");
document.documentElement.appendChild(script);

const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

const keyCodes = {
    backspace: 8,
    enter: 13,
    esc: 27,
    end: 35,
    home: 36,
    left: 37,
    up: 38,
    right: 39,
    down: 40,
    "delete": 46,
    f: 70,
};

const wordModifierKey = isMac ? 'alt' : 'control'
const paragraphModifierKey = isMac ? 'alt' : 'control'

function wordMods(shift = false) {
    return { shift, [wordModifierKey]: true }
}

function paragraphMods(shift = false) {
    return { shift, [paragraphModifierKey]: true }
}

function querySelectorAny(selectors, root = document) {
    if (!Array.isArray(selectors)) selectors = [selectors]
    for (const selector of selectors) {
        const el = root.querySelector?.(selector)
        if (el) return el
    }
    return null
}

function waitForElement(selectors, { attempts = 40, interval = 50 } = {}) {
    return new Promise((resolve, reject) => {
        let tries = 0
        const probe = () => {
            const el = querySelectorAny(selectors)
            if (el) {
                resolve(el)
                return
            }
            tries += 1
            if (tries >= attempts) {
                reject(new Error('Element not found'))
                return
            }
            setTimeout(probe, interval)
        }
        probe()
    })
}

const SEARCH_INPUT_SELECTORS = [
    'input[aria-label="Search in doc"]',
    'input[aria-label="Search in document"]',
    'input[aria-label="Find in document"]'
]

const SEARCH_CLOSE_SELECTORS = [
    '[aria-label="Close search"]',
    '[aria-label="Close"]'
]

const findOverlayModifiers = isMac ? { meta: true } : { control: true }

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function dispatchKeyOnElement(el, keyCode, keyValue) {
    if (!el) return
    const options = { key: keyValue, keyCode, which: keyCode, bubbles: true }
    const keyDown = new KeyboardEvent('keydown', options)
    Object.defineProperty(keyDown, 'keyCode', { get() { return keyCode } })
    Object.defineProperty(keyDown, 'which', { get() { return keyCode } })
    const keyUp = new KeyboardEvent('keyup', options)
    Object.defineProperty(keyUp, 'keyCode', { get() { return keyCode } })
    Object.defineProperty(keyUp, 'which', { get() { return keyCode } })
    el.dispatchEvent(keyDown)
    el.dispatchEvent(keyUp)
}

function focusEditorSurface() {
    try {
        iframe?.contentWindow?.focus()
    } catch (error) {
        console.warn('DocKeys: Unable to focus editor', error)
    }
}

async function collapseSearchSelection(queryLength) {
    if (!queryLength) return
    await delay(40)
    sendKeyEvent('right')
    await delay(40)
    for (let i = 0; i < queryLength; i++) {
        sendKeyEvent('left')
        await delay(20)
    }
}

// Send request to injected page script to simulate keypress
// Messages are passed to page script via "doc-keys-simulate-keypress" events, which are dispatched
// on the window object by the content script.
function sendKeyEvent(key, mods = {}) {
    const keyCode = keyCodes[key]
    const defaultMods = { shift: false, control: false, alt: false, meta: false }
    window.dispatchEvent(new CustomEvent("doc-keys-simulate-keypress", { detail: { keyCode, mods: { ...defaultMods, ...mods } } }));
}

//Mode indicator thing (insert, visualline)
const modeIndicator = document.createElement('div')
modeIndicator.style.position = 'fixed'
modeIndicator.style.bottom = '20px'
modeIndicator.style.right = '20px'
modeIndicator.style.padding = '8px 16px'
modeIndicator.style.borderRadius = '4px'
modeIndicator.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
modeIndicator.style.fontSize = '14px'
modeIndicator.style.fontWeight = '500'
modeIndicator.style.zIndex = '9999'
document.body.appendChild(modeIndicator)

function updateModeIndicator(currentMode) {
    let label = currentMode.toUpperCase()
    switch(currentMode) {
        case 'normal':
            modeIndicator.style.backgroundColor = '#1a73e8'
            modeIndicator.style.color = 'white'
            break
        case 'insert':
            modeIndicator.style.backgroundColor = '#34a853'
            modeIndicator.style.color = 'white'
            break
        case 'visual':
        case 'visualLine':
            modeIndicator.style.backgroundColor = '#fbbc04'
            modeIndicator.style.color = 'black'
            break
        case 'waitForFirstInput':
        case 'waitForSecondInput':
        case 'waitForVisualInput':
        case 'waitForFindChar':
        case 'waitForSneakFirstChar':
        case 'waitForSneakSecondChar':
        case 'searchPending':
            modeIndicator.style.backgroundColor = '#ea4335'
            modeIndicator.style.color = 'white'
            if (currentMode === 'waitForFindChar') label = 'F'
            if (currentMode === 'waitForSneakFirstChar' || currentMode === 'waitForSneakSecondChar') label = 'S'
            if (currentMode === 'searchPending') label = 'SEARCH'
            break
    }
    modeIndicator.textContent = label
}

function repeatMotion(motion, times, key) {
  for (let i = 0; i < times; i++) {
      motion(key)
  }
}

function switchModeToVisual() {
    mode = 'visual'
    updateModeIndicator(mode)
    sendKeyEvent('right', { shift: true })
    pendingSearch = null
}

function switchModeToVisualLine() {
    mode = 'visualLine'
    updateModeIndicator(mode)
    sendKeyEvent('home')
    sendKeyEvent('down', { shift: true })
    pendingSearch = null
}

function switchModeToNormal() {
    if (mode == "visualLine" || mode == "waitForFirstInput") sendKeyEvent("left")
    mode = 'normal'
    updateModeIndicator(mode)

    //caret indicating visual mode 
    cursorTop.style.opacity = 1
    cursorTop.style.display = "block"
    cursorTop.style.backgroundColor = "black"
    pendingSearch = null
}

function switchModeToInsert() {
    mode = 'insert'
    updateModeIndicator(mode)
    cursorTop.style.opacity = 0
    pendingSearch = null
}

function switchModeToWait() {
    mode = "waitForFirstInput"
    updateModeIndicator(mode)
    // define cursor style
}

function switchModeToWait2() {
    mode = "waitForSecondInput"
    updateModeIndicator(mode)
    // define cursor style
}

let longStringOp = ""


function goToStartOfLine() {
    sendKeyEvent("home")
}

function goToEndOfLine() {
    sendKeyEvent("end")
}

function selectToStartOfLine() {
    sendKeyEvent("home", { shift: true })
}

function selectToEndOfLine() {
    sendKeyEvent("end", { shift: true })
}

function selectToStartOfWord() {
    sendKeyEvent("left", wordMods(true))
}

function selectToEndOfWord() {
    sendKeyEvent("right", wordMods(true))
}

function goToEndOfWord() {
    sendKeyEvent("right", wordMods())
}

function goToStartOfWord() {
    sendKeyEvent("left", wordMods())
}

function goToTop() {
    sendKeyEvent("home", { control: true, shift: true })
    longStringOp = ""
}

function selectToEndOfPara() {
    sendKeyEvent("down", paragraphMods(true))
}
function goToEndOfPara(shift = false) {
    sendKeyEvent("down", paragraphMods(shift))
    sendKeyEvent("right", { shift })
}
function goToStartOfPara(shift = false) {
    sendKeyEvent("up", paragraphMods(shift))
}


function startFindCommand(type) {
    pendingSearch = { type, query: '' }
    if (type === 'f') {
        mode = 'waitForFindChar'
    } else if (type === 's') {
        mode = 'waitForSneakFirstChar'
    }
    updateModeIndicator(mode)
}

function handleFindCharTarget(key) {
    if (!pendingSearch || pendingSearch.type !== 'f') {
        switchModeToNormal()
        return
    }
    if (key.length !== 1) {
        switchModeToNormal()
        return
    }
    pendingSearch = null
    performDocSearch(key)
}

function handleSneakFirstTarget(key) {
    if (!pendingSearch || pendingSearch.type !== 's') {
        switchModeToNormal()
        return
    }
    if (key.length !== 1) {
        switchModeToNormal()
        return
    }
    pendingSearch.query = key
    mode = 'waitForSneakSecondChar'
    updateModeIndicator(mode)
}

function handleSneakSecondTarget(key) {
    if (!pendingSearch || pendingSearch.type !== 's') {
        switchModeToNormal()
        return
    }
    if (key.length !== 1) {
        switchModeToNormal()
        pendingSearch = null
        return
    }
    pendingSearch.query += key
    const query = pendingSearch.query
    pendingSearch = null
    performDocSearch(query)
}

async function performDocSearch(query) {
    if (!query) {
        switchModeToNormal()
        return
    }
    mode = 'searchPending'
    updateModeIndicator(mode)
    try {
        sendKeyEvent('f', findOverlayModifiers)
        await delay(50)

        const input = await waitForElement(SEARCH_INPUT_SELECTORS)
        input.focus()
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.value = query
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.setSelectionRange(query.length, query.length)

        await delay(90)

        const closeButton = querySelectorAny(SEARCH_CLOSE_SELECTORS)
        if (closeButton) {
            simulateClick(closeButton)
        } else {
            dispatchKeyOnElement(document.activeElement || document.body, keyCodes.esc, 'Escape')
        }
        focusEditorSurface()
        await collapseSearchSelection(query.length)
    } catch (error) {
        console.warn('DocKeys: Search failed', error)
        focusEditorSurface()
    } finally {
        focusEditorSurface()
        switchModeToNormal()
    }
}


function addLineTop() {
    goToStartOfLine()
    sendKeyEvent("enter", { shift: true })
    sendKeyEvent("up")
    switchModeToInsert()
}
function addLineBottom() {
    goToEndOfLine()
    sendKeyEvent("enter", { shift: true })
    switchModeToInsert()
}

function runLongStringOp(operation = longStringOp) {
    switch (operation) {
        case "c":
            clickMenu(menuItems.cut)
            switchModeToInsert()
            break
        case "d":
            clickMenu(menuItems.cut)
            sendKeyEvent('backspace')
            mode = 'normal'
            switchModeToNormal()
            break
        case "y":
            clickMenu(menuItems.copy)
            switchModeToNormal()
            break
        case "p":
            clickMenu(menuItems.paste)
            switchModeToNormal()
            break
        case "v":
            break
        case "g":
            goToTop()
            break
    }
}


function waitForSecondInput(key) {
    switch (key) {
        case "w":
            goToStartOfWord()
            waitForFirstInput(key)
            break
        case "p":
            goToStartOfPara()
            waitForFirstInput(key)
            break
        default:
            switchModeToNormal()
            break
    }
}

function waitForFirstInput(key) {
    switch (key) {
        case "i":
        case "a":
            switchModeToWait2()
            break
        case "w":
            selectToEndOfWord()
            runLongStringOp()
            break
        case "p":
            selectToEndOfPara()
            runLongStringOp()
            break
        case "^":
        case "_":
        case "0":
            selectToStartOfLine()
            runLongStringOp()
            break
        case "$":
            selectToEndOfLine()
            runLongStringOp()
            break
        case longStringOp:
            goToStartOfLine()
            selectToEndOfLine()
            runLongStringOp()
            break
        default:
            switchModeToNormal()
    }
}

function waitForVisualInput(key) {
    switch (key) {
        case "w":
            sendKeyEvent("left",{control:true})
            goToStartOfWord()
            selectToEndOfWord()
            break
        case "p":
            goToStartOfPara()
            goToEndOfPara(true)
            break
    }
    mode = "visualLine"
}

function handleMutlipleMotion(key) {
    if (/[0-9]/.test(key)) {
        multipleMotion.times = Number(String(multipleMotion.times)+key)
        return
    }

    if (["f", "s"].includes(key)) {
        // Counts for find-style motions are not supported yet; fall back to single execution.
        mode = multipleMotion.mode
        if (mode === "normal") {
            multipleMotion.times = 0
            handleKeyEventNormal(key)
        }
        return
    }

    switch (multipleMotion.mode) {
        case "normal":
            repeatMotion(handleKeyEventNormal,multipleMotion.times,key)
            break
        case "visualLine":
        case "visual":
            repeatMotion(handleKeyEventVisualLine,multipleMotion.times,key)
            break
    }

    mode = multipleMotion.mode
}



function eventHandler(e) {
    if (
        ["Shift","Meta","Control","Alt",""].includes(e.key)
    ) return
        
    
    if (e.ctrlKey && mode=='insert' && e.key=='o' ){
        e.preventDefault()
        e.stopImmediatePropagation()
        switchModeToNormal()

        // Turn on state variable to indicate temperory normal mode
        tempnormal = true
        return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key == 'Escape') {
        e.preventDefault()
        if (mode == 'visualLine' || mode == 'visual') {
            sendKeyEvent("right")
        }
        switchModeToNormal()
        return;
    }
    if (mode != 'insert') {
        e.preventDefault()
        switch (mode) {
            case "normal":
                handleKeyEventNormal(e.key)
                break
            case "visual":
            case "visualLine":
                handleKeyEventVisualLine(e.key)
                break
            case "waitForFirstInput":
                waitForFirstInput(e.key)
                break
            case "waitForSecondInput":
                waitForSecondInput(e.key)
                break
            case "waitForVisualInput":
                waitForVisualInput(e.key)
                break
            case "multipleMotion":
                handleMutlipleMotion(e.key)
                break
            case "waitForFindChar":
                handleFindCharTarget(e.key)
                break
            case "waitForSneakFirstChar":
                handleSneakFirstTarget(e.key)
                break
            case "waitForSneakSecondChar":
                handleSneakSecondTarget(e.key)
                break
            case "searchPending":
                break
        }
    }
}

function handleKeyEventNormal(key) {

    if (/[0-9]/.test(key)) {
        mode = "multipleMotion"
        multipleMotion.mode = "normal"
        multipleMotion.times = Number(key)
        return
    }
    
    switch (key) {
        case "h":
            sendKeyEvent("left")
            break
        case "j":
            sendKeyEvent("down")
            break
        case "k":
            sendKeyEvent("up")
            break
        case "l":
            sendKeyEvent("right")
            break
        case "}":
            goToEndOfPara()
            break
        case "{":
            goToStartOfPara()
            break
        case "b":
            goToStartOfWord()
            break
        case "e":
        case "w":
            goToEndOfWord()
            break
        case "g":
            sendKeyEvent("home", { control: true })
            break
        case "G":
            sendKeyEvent("end", { control: true })
            break
        case "f":
            startFindCommand('f')
            break
        case "s":
            startFindCommand('s')
            break
        case "c":
        case "d":
        case "y":
            longStringOp = key
            mode = "waitForFirstInput"
            break
        case "p":
            clickMenu(menuItems.paste)
            break
        case "a":
            sendKeyEvent("right")
            switchModeToInsert()
            break
        case "i":
            switchModeToInsert()
            break
        case "^":
        case "_":
        case "0":
            goToStartOfLine()
            break
        case "$":
            goToEndOfLine()
            break
        case "I":
            goToStartOfLine()
            switchModeToInsert()
            break
        case "A":
            goToEndOfLine()
            switchModeToInsert()
            break
        case "v":
            switchModeToVisual()
            break
        case "V":
            switchModeToVisualLine()
            break
        case "o":
            addLineBottom()
            break
        case "O":
            addLineTop()
            break
        case "u":
            clickMenu(menuItems.undo)
            break
        case "r":
            clickMenu(menuItems.redo)
            break
        case "/":
            clickMenu(menuItems.find)
            break
        case "x":
            sendKeyEvent("delete")
            break
        default:
            return;
    }
    // Check if operation is occuring in temperory normal mode after ctrl-o
    if (tempnormal) {
        tempnormal = false
        if (mode != 'visual' && mode != 'visualLine'){  // Switch back to insert 
            switchModeToInsert()                        // after operation
            }
    }
}

function handleKeyEventVisualLine(key) {

    if (/[0-9]/.test(key)) {
        mode = "multipleMotion"
        multipleMotion.mode = "visualLine"
        multipleMotion.times = Number(key)
        return
    }

    switch (key) {
        case "":
            break
        case "h":
            sendKeyEvent("left", { shift: true })
            break
        case "j":
            sendKeyEvent("down", { shift: true })
            break
        case "k":
            sendKeyEvent("up", { shift: true })
            break
        case "l":
            sendKeyEvent("right", { shift: true })
            break
        case "p":
            clickMenu(menuItems.paste)
            switchModeToNormal()
            break
        case "}":
            goToEndOfPara(true)
            break
        case "{":
            goToStartOfPara(true)
            break
        case "b":
            selectToStartOfWord()
            break
        case "e":
        case "w":
            selectToEndOfWord()
            break
        case "^":
        case "_":
        case "0":
            selectToStartOfLine()
            break
        case "$":
            selectToEndOfLine()
            break
        case "G":
            sendKeyEvent("end", { control: true, shift: true })
            break
        case "g":
            sendKeyEvent("home", { control: true, shift: true })
            break
        case "c":
        case "d":
        case "y":
            runLongStringOp(key)
            break
        case "i":
        case "a":
            mode = "waitForVisualInput"
            break


    }
}

let menuItemElements = {}

let menuItems = {
    copy: { parent: "Edit", caption: "Copy" },
    cut: { parent: "Edit", caption: "Cut" },
    paste: { parent: "Edit", caption: "Paste" },
    redo: { parent: "Edit", caption: "Redo" },
    undo: { parent: "Edit", caption: "Undo" },
    find: { parent: "Edit", caption: "Find" },
}

function clickMenu(itemCaption) {
    const target = getMenuItem(itemCaption);
    if (!target) return;
    simulateClick(target);
}

function clickToolbarButton(captionList) {
    // Sometimes a toolbar button won't exist in the DOM until its parent has been clicked, so we
    // click all of its parents in sequence.
    for (const caption of Array.from(captionList)) {
        const els = document.querySelectorAll(`*[aria-label='${caption}']`);
        if (els.length == 0) {
            console.log(`Couldn't find the element for the button labeled ${caption}.`);
            console.log(captionList);
            return;
        }
        // Sometimes there are multiple elements that have the same label. When that happens, it's
        // ambiguous which one to click, so we log it so it's easier to debug.
        if (els.length > 1) {
            console.log(
                `Warning: there are multiple buttons with the caption ${caption}. ` +
                "We're expecting only 1.",
            );
            console.log(captionList);
        }
        simulateClick(els[0]);
    }
}
// Returns the DOM element of the menu item with the given caption. Prints a warning if a menu
// item isn't found (since this is a common source of errors in SheetKeys) unless silenceWarning
// is true.

function getMenuItem(menuItem, silenceWarning = false) {
    const caption = menuItem.caption;
    let el = menuItemElements[caption];
    if (el) return el;
    el = findMenuItem(menuItem);
    if (!el) {
        if (!silenceWarning) console.error("Could not find menu item with caption", menuItem.caption);
        return null;
    }
    return menuItemElements[caption] = el;
}

function findMenuItem(menuItem) {
    activateTopLevelMenu(menuItem.parent);
    const menuItemEls = document.querySelectorAll(".goog-menuitem");
    const caption = menuItem.caption;
    const isRegexp = caption instanceof RegExp;
    for (const el of Array.from(menuItemEls)) {
        const label = el.innerText;
        if (!label) continue;
        if (isRegexp) {
            if (caption.test(label)) {
                return el;
            }
        } else {
            if (label.startsWith(caption)) {
                return el;
            }
        }
    }
    return null;
}

function simulateClick(el, x = 0, y = 0) {
    const eventSequence = ["mouseover", "mousedown", "mouseup", "click"];
    for (const eventName of eventSequence) {
        const event = document.createEvent("MouseEvents");
        event.initMouseEvent(
            eventName,
            true, // bubbles
            true, // cancelable
            window, //view
            1, // event-detail
            x, // screenX
            y, // screenY
            x, // clientX
            y, // clientY
            false, // ctrl
            false, // alt
            false, // shift
            false, // meta
            0, // button
            null, // relatedTarget
        );
        el.dispatchEvent(event);
    }
}

function activateTopLevelMenu(menuCaption) {
    const buttons = Array.from(document.querySelectorAll(".menu-button"));
    const button = buttons.find((el) => el.innerText.trim() == menuCaption);
    if (!button) {
        throw new Error(`Couldn't find top-level button with caption ${menuCaption}`);
    }
    // Unlike submenus, top-level menus can be hidden by clicking the button a second time to
    // dismiss the menu.
    simulateClick(button);
    simulateClick(button);
}

// Initiate to Normal Mode
switchModeToNormal()
