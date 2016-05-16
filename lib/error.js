module.exports = function({ msg = 'Internal error', code = 500 } = {}) {
    return {
        msg: msg,
        code: code
    }
}