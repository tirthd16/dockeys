# DocsKeys

A browser extension that brings Vim-style keyboard shortcuts to Google Docs, allowing you to edit documents with familiar Vim motions and commands.

While this extension currently implements core Vim functionality including basic motions, text manipulation, and visual selections, there's room for expansion. Contributions are welcome to add more Vim features as per your need.

If you are using DocsKeys with Vimium, disable Vimium on Google Docs.

This project is heavily inspired by and uses much of code from [SheetKeys](https://github.com/philc/sheetkeys)

### Available Motions

#### Basic Movement
- `h` - Move cursor left
- `j` - Move cursor down
- `k` - Move cursor up
- `l` - Move cursor right
- `w` - Move to start of next word
- `b` - Move to start of previous word
- `e` - Move to end of current word

### Numbered Prefixed Motions

- `{n}h` - Move cursor left n times
- `{n}j` - Move cursor down n times
- `{n}k` - Move cursor up n times
- `{n}l` - Move cursor right n times
- `{n}w` - Move to start of n words
- `{n}b` - Move to start of n previous word
- `{n}e` - Move to end of n word

#### Line Navigation
- `0` or `^` or `_` - Go to start of line
- `$` - Go to end of line
- `I` - Go to start of line and enter insert mode
- `A` - Go to end of line and enter insert mode

#### Document Navigation
- `g` - Go to document start
- `G` - Go to document end
- `{` - Go to start of paragraph
- `}` - Go to end of paragraph
- `/` - Opens Find & Replace Dialog

### Editing Commands

#### Mode Switching
- `i` - Enter insert mode
- `a` - Enter insert mode (after cursor)
- `v` - Enter visual mode
- `V` - Enter visual line mode
- `Esc` - Return to normal mode
- `Ctrl` + `o` - Temporary normal mode from insert mode

#### Text Manipulation
- `d` + motion - Delete (supports `dw`, `diw`, `dp`, `dip`, `dd`, `d_`, `d0`, `d$`)
- `c` + motion - Change (supports `cw`, `ciw`, `cp`, `cip`, `cc`, `c^`)
- `y` + motion - Yank/copy (supports `yw`, `yiw`, `yp`, `yip`, `yy`, `y0`)
- `p` - Paste
- `u` - Undo
- `r` - Redo
- `x` - Delete character in front of cursor

#### Line Operations
- `o` - Add new line below and enter insert mode
- `O` - Add new line above and enter insert mode

### Visual Mode Commands
When in visual mode (`v` or `V`):
- All movement keys (`h`, `j`, `k`, `l`, `w`, `b`, etc.) extend the selection
- `d` - Delete selected text
- `c` - Change selected text
- `y` - Yank selected text
- `p` - Paste over selected text

## Installation

[Chrome Web Store](https://chromewebstore.google.com/detail/docskeys/mmmomengbindngnkjblabjebdfmaiccj) |
[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/docskeys/)

Install from source
- Check out this repository
- Navigate to chrome://extensions in Chrome
- Toggle into Developer Mode
- Click on "Load Unpacked Extension..."
- Select the docskeys folder

## Usage

1. Open a Google Doc
2. Extension will automatically activate
3. Start using Vim commands in normal mode
4. Press `i` or `a` to enter insert mode for regular typing
5. Press `Esc` to return to normal mode

## Known Limitations

- Most advanced Vim features like marks, macros, and registers are not supported
- Custom key mappings are not supported
- PR's are welcome to add these features

## License

See [MIT-LICENSE.txt](MIT-LICENSE.txt) for details.
