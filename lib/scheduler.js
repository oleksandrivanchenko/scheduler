'use strict'

const Event = require('./event')
const error = require('./error')

class Scheduler {
    constructor(server, { verbose = true, interval = 300 }) {
        this.interval = interval * 1000 // to millis
        this.server = server
        this.v = verbose
        this.__events = new Map()
        this._init()
    }
    
    add(slug, key, props = {}) {
        props.slug = slug
        props.key = key
        return new Promise((resolve, reject) => {
            if (!props.run_at) {
                return reject(error({
                    code: 400,
                    msg: 'Missing required field "run_at"'
                }))
            }
            
            new Event(props)
                .save()
                .then(event => {
                    let now = Date.now()
                    if (event.run_at.getTime() <= now + this.interval) {
                        this.dispatchAt(event, event.run_at.getTime() - now)
                    }
                    resolve(event)
                })
                .catch(reject)
        })
    }
    
    del(slug, key) {
        let hash = `${slug}:${key}`
        if (this.v) console.log(`Deleting event ${hash}`)
        if (this.__events.has(hash)) {
            clearTimeout(this.__events.get(hash).timer)
            this.__events.delete(hash)
        }
        
        return new Promise((resolve, reject) => {
            new Event({ slug: slug, key: key })
                .destroy()
                .then(r => resolve({ deleted: r }))
                .catch(reject)
        })
    }
    
    dispatch(event) {
        let { slug, key, payload, fail_count = 0, endpoint, run_at, recurring } = event
        let _this = this
        return () => {
            if (_this.v) {
                console.log(`Dispatching event ${event.getHash()} to ${endpoint} with the following payload:`)
                console.log(payload)
            }
            _this.__events.delete(event.getHash())
            
            let protocol
            if (endpoint.includes('//')) {
                [protocol, endpoint] = endpoint.split('//')
            }
            let i = endpoint.indexOf('/')
            if (i === -1) i = endpoint.length // If / not found, place index at end
            let host = endpoint.substr(0, i)
            let path = endpoint.substr(i)
            let port
            
            if (host.includes(':')) {
                [host, port] = host.split(':')
            }
            
            if (protocol === 'https:') {
                port = 443;
            }
            
            let req = _this.server.request({
                host: host,
                protocol: protocol,
                port: port,
                path: path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, res => {
                let data = ''
                res.on('data', chunk => {
                    data += chunk
                })
                res.on('end', () => {
                    // TODO check for errors
                    if (recurring) {
                        event
                            .recur()
                            .then(event => {
                                let now = Date.now()
                                
                                if (event.run_at.getTime() <= now + this.interval) {
                                    this.dispatchAt(event, event.run_at.getTime() - now)
                                }
                            })
                            .catch(err => {
                                console.error(`Error rescheduling event ${event.getHash()}`)
                                console.error(err)
                            })
                    } else {
                        event
                            .destroy()
                            .then()
                            .catch(err => {
                                console.error(`Error deleting event ${event.getHash()}`)
                                console.error(err)
                            })
                    }
                    
                })
                res.on('error', fail)
            })
            req.on('error', fail)
            req.write(JSON.stringify(payload))
            req.end()
            
            function fail(err) {
                console.error(`Error dispatching event ${event.getHash()}`)
                console.error(err)
                event
                    .save({ fail_count: ++fail_count })
                    .then()
                    .catch(e => { console.error(`Fatal error updating fail count for ${event.getHash()}`, e) })
            }
        }
    }
    
    dispatchAt(event, delay) {
        let hash = event.getHash()
        if (this.__events.has(hash)) {
            let eventTimer = this.__events.get(hash)
            // If the event's run_at time isn't different than the one to be executed, skip inserting it
            if (eventTimer.run_at === event.run_at) return
            clearTimeout(eventTimer.timer)
            this.__events.delete(hash) // If this task already exists, clear it
        }
        if (this.v) console.log(`Setting event ${hash} to dispatch in ${delay / 1000} seconds`)
        this.__events.set(hash, { run_at: event.run_at, timer: setTimeout(this.dispatch(event), delay) })
    }
    
    get(slug, key) {
        return Event.fetch(slug, key)
    }
    
    update(slug, key, updates) {
        return new Promise((resolve, reject) => {
            new Event({ slug: slug, key: key })
                .save(updates)
                .then(event => {
                    let hash = event.getHash()
                    let now = Date.now()
                    
                    if (this.__events.has(hash)) {
                        clearTimeout(this.__events.get(hash).timer)
                        this.__events.delete(hash)
                    }
                    if (event.run_at.getTime() <= now + this.interval) {
                        this.dispatchAt(event, event.run_at.getTime() - now)
                    }
                    
                    resolve(event)
                })
                .catch(reject)  
        })
    }
    
    list(before, after) {
        return Event.list(before, after)
    }
    
    _fetch() {
        Event
            .list(Date.now() + this.interval)
            .then(events => {
                if (this.v) console.log(`Dispatching ${events.length} events`)
                let now = Date.now()
                events.forEach(e => {
                    this.dispatchAt(e, e.run_at.getTime() - now)
                })
            })
    }
    
    _init() {
        this._fetch()
        this.__timer = setInterval(()=>{this._fetch()}, this.interval)
    }
}

module.exports = Scheduler
