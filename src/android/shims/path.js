// Android paths are POSIX.
const posix = require('path-browserify');
module.exports = { ...posix, posix, win32: posix, default: posix };
