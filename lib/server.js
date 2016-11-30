'use strict'

const http = require('http')
const Scheduler = require('./scheduler')
const Settings = require('./settings')
const winston = require('./winston')

/**
 * TODO
 *  - auth
 */

class Server {
    constructor({ port = 3000 } = {}) {
        this.port = Settings.port

        this.scheduler = new Scheduler()
        this.server = http.createServer()
    	this.server.on('request', (req, res) => { this.connect(req, res) })
    }

    connect(req, res) {
        let [url, query = {}] = req.url.split('?')
        let [slug, key] = url.split('/').slice(1, 3)
        let body = ''

        if (typeof query === 'string') {
            let q = {}
            query.split('&').forEach(s => {
                if (!s) return
                let [_key, _value] = s.split('=')
                q[_key] = _value
            })
            query = q
        }
        
        req
            .on('data', b => { body += b })
            .on('end', process)
            .on('error', error)
        
        let _this = this
        function process() {
            if (body) {
                try {
                    body = JSON.parse(body)
                } catch(e) {
                    res.statusCode = 400
                    return res.end('INVALID JSON')
                }
            } else {
                body = undefined
            }

            let promise
            switch (req.method.toUpperCase()) {
                case 'POST':
                    promise = _this.scheduler.add(slug, key, body)
                    break
                case 'DELETE':
                    promise = _this.scheduler.del(slug, key).then(deleted => ({ deleted }))
                    break
                case 'PUT':
                    promise = _this.scheduler.update(slug, key, body)
                    break
                case 'GET':
                    if (slug === 'list') promise = _this.scheduler.list({ slug: query.slug, before: query.before, after: query.after, failed: parseBool(query.failed) })
                    else if (slug) promise = _this.scheduler.get(slug, key)
                    else {
                        res.statusCode = 404
                        return res.end()
                    }
                    break
                default:
                    res.statusCode = 400
                    return res.end()
            }

            promise
                .then(done)
                .catch(error)
        }
        
        function done(data) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ result: data }))
        }
            
        function error(err) {
            if (err) winston.error(err)
            res.statusCode = err.code || 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
                error: {
                    code: err.code,
                    message: err.message
                }
            }))
        }
    }
    
    start() {
        this.server.listen(this.port, () => {
            winston.info(`Server successfully bound to port ${this.port}`)
        })
    }
    
    stop() {
        this.server.close(() => {
            winston.info('Server successfully closed')
        })
    }
}

function parseBool(val) {
    return val == null ? val : (!['f', 'false', '0'].includes(String(val).toLowerCase()))
}

module.exports = Server
