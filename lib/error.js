module.exports = function({ msg = 'Internal error', status = 500 } = {}) {
    return {
        msg: msg,
        statusCode: statusCode
    }
}