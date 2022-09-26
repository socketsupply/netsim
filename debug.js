
var DEBUG = +(process.env.DEBUG)
module.exports = DEBUG ? function (level, ...args) {
    if(level <= DEBUG) console.log(...args)
} : function () {}