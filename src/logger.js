// By default, do nothing
exports.log = function () {};

exports.setLogger = function setLogger(fn) {
  exports.enabled = true;
  if (fn) {
    exports.log = fn;
  } else {
    exports.log = function () {
      console.log.apply(console, arguments);
    }
  }
};
