'use strict'

const EventEmitter = require('events').EventEmitter
const https = require('https')

/**
 * TODO
 *      - Move verbose logging to scheduler
 *      - Auth integration for requests
 * 
 * EVENTS
 *      done - Request completed successfully
 *      error - Error encountered
 *      failed - Request failed to execute
 *      retry - Request failed, retrying
 *      execute - Event is being executed
 */

class Worker extends EventEmitter {
    constructor({ redis, running = true, retries = 3, retry_timeout }) {
        super()

        this.redis = redis
        this.retries = retries
        this.timeout = retry_timeout
        this.running = running
        if (this.event) this.execute(event)
    }

    /**
     * Executes the provided event
     * 
     * @param event {Event}
     * @param __tries {Integer} optional
     */
    execute(event, __tries = 0) {
        if (!running) return

        this.emit('execute', event)

        let _this = this
        let protocol, endpoint = event.endpoint
        if (endpoint.includes('//')) [protocol, endpoint] = endpoint.split('//')
        let i = endpoint.indexOf('/')
        if (i === -1) i = endpoint.length // If / not found, place index at end
        let host = endpoint.substr(0, i)
        let path = endpoint.substr(i)
        let port

        if (host.includes(':')) [host, port] = host.split(':')
        if (protocol === 'https:') port = 443

        let req = https.request({
            host,
            protocol,
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, res => {
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => done(data))
            res.on('error', fail)
        })
        req.write(JSON.stringify(payload))
        req.end()
        req.on('error', fail)

        function done(response) {
            this.emit('done', { event, response })
            this.getJob()
        }

        function fail(error) {
            if (__tries === this.retries) {
                err.try_number = __tries
                _this.emit('failed', { error, event, attempt: __tries})
            } else {
                _this.emit('retry', { error, event })
                setTimeout(() => _this.execute(event, ++__tries), this.timeout)
            }
        }
    }

    getJob() {
        this.redis
            
    }
}

module.exports = Worker