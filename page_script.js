// source- https://github.com/philc/sheetkeys/blob/master/page_scripts/page_script.js

// This script gets inserted into the page by our content script.
// It receives requests from the content script to simulate keypresses.
// Messages are passed to this script via "doc-keys-simulate-keypress" events, which are dispatched
// on the window object by the content script.

// How to simulate a keypress in Chrome: http://stackoverflow.com/a/10520017/46237
// Note that we have to do this keypress simulation in an injected script, because events dispatched
// by content scripts do not preserve overridden properties.
// - args: an object with keys keyCode, shiftKey
const simulateKeyEvent = function(eventType, el, args) {
    // How to do this in Chrome: http://stackoverflow.com/q/10455626/46237
    const event = document.createEvent("KeyboardEvent");
    Object.defineProperty(event, "keyCode", {
        get() {
            return this.keyCodeVal;
        },
    });
    Object.defineProperty(event, "which", {
        get() {
            return this.keyCodeVal;
        },
    });
    event.initKeyboardEvent(
        eventType, // eventName
        true, // canBubble
        true, //canceleable
        document.defaultView, // view
        "", // keyIdentifier string
        false, // (not sure)
        args.mods?.control, // control
        null, // (not sure)
        args.mods?.shift, // shift
        false,
        args.keyCode, // keyCode
        args.keyCode, // (not sure)
    );
    event.keyCodeVal = args.keyCode;
    el.dispatchEvent(event);
};

const editorEl = document.querySelector(".docs-texteventtarget-iframe").contentDocument.activeElement;

window.addEventListener("doc-keys-simulate-keypress", function(event) {
    const args = event.detail
    simulateKeyEvent("keydown", editorEl, args);
    simulateKeyEvent("keyup", editorEl, args);
});


