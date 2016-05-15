'use strict'

/**
 * INDICIES
 *  - (slug, key)
 *  - run_at: -1
 */
class Scheduler {
    
    constructor(server, { db, verbose = true, interval = 300 }) {
	    this.collection = db.collection('events')
        this.interval = interval * 1000 // to millis
        this.server = server
        this.v = verbose
        this.__events = new Map()
        this._init()
    }
    
    add(slug = 'event-slug', key = '', { 
        endpoint = null, // required
        recurring,
        run_at = null, // required
        payload = {} 
    } = {}) {
        return this.update(slug, key, {         // Unique ID (i.e. user's id for their profile notif)
            endpoint: endpoint,                 // The URL which to hit (must be via POST)
            recurring: recurring,        // second interval for trigger (false for single time)
            run_at: new Date(run_at).getTime(), // DateTime to run event
            payload: payload,                   // JSON body to forward to the endpoint
            fail_count: null
        }, true)
    }
    
    del(slug, key) {
        let hash = `${slug}:${key}`
        if (this.v) console.log(`Deleting event ${slug}:${key}`)
        if (this.__events.has(hash)) {
            clearTimeout(this.__events.get(hash))
            this.__events.delete(hash)
        }
        
        return new Promise((resolve, reject) => {
            this.collection.removeOne({
                slug: slug,
                key: key
            }, (err, result) => {
                if (err) reject(err)
                else resolve({ deleted: result.deletedCount > 0 })
            })
        })
    }
    
    dispatch({ slug, key, payload, fail_count = 0, endpoint, run_at, recurring } = {}) {
        let _this = this
        return function() {
            if (_this.v) {
                console.log(`Dispatching event ${slug}:${key} to ${endpoint} with the following payload:`)
                console.log(payload)
            }
            _this.__events.delete(`${slug}:${key}`)
            let i = endpoint.indexOf('/')
            let host = endpoint.substr(0, i)
            let path = endpoint.substr(i)
            let port, protocol
            
            if (host.includes('//')) {
                [protocol, host] = host.split('//')
            }
            if (host.includes(':')) {
                [host, port] = host.split(':')
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
                        _this
                            .update(slug, key, { run_at: run_at + recurring })
                            .then()
                            .catch(err => {
                                console.error(`Error rescheduling event ${slug}:${key}`)
                                console.error(err)
                            })
                    } else {
                        _this
                            .del(slug, key)
                            .then()
                            .catch(err => {
                                console.error(`Error deleting event ${slug}:${key}`)
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
                console.error(`Error dispatching event ${slug}:${key}`)
                console.error(err)
                _this
                    ._update(slug, key, { fail_count: ++fail_count })
                    .then()
                    .catch(e => { console.error(`Fatal error updating fail count for ${slug}:${key}`, e) })
            }
        }
    }
    
    dispatchAt(event, delay) {
        let hash = `${event.slug}:${event.key}`
        if (this.v) console.log(`Setting event ${hash} to dispatch in ${delay / 1000} seconds`)
        this.__events.set(hash, setTimeout(this.dispatch(event), delay))
    }
    
    get(slug, key) {
        return new Promise((resolve, reject) => {
            this.collection.find({
                slug: slug,
                key: key
            }).limit(1).next((err, event) => {
                if (err) return reject(err)
                if (!event) return reject(new Error('Not Found'))
                delete event._id
                resolve(event)
            })
        })
    }
    
    update(slug, key, updates, upsert = false) {
        let hash = `${slug}:${key}`
	    let now = Date.now()
        if (this.v) console.log(`${upsert?'Creating':'Updating'} event ${hash}`)
        
        return new Promise((resolve, reject) => {
            this
                ._update(...arguments)
                .then(event => {
                    if (this.__events.has(hash)) {
                        clearTimeout(this.__events.get(hash))
                        this.__events.delete(hash)
                    }
                    if (event.run_at <= now + this.interval) {
                        this.dispatchAt(event, event.run_at - Date.now())
                    }
                    
                    resolve(event)
                })
                .catch(reject)  
        })
    }
    
    _update(slug, key, updates, upsert = false) {
        if (this.v) console.log(`${upsert?'Creating':'Updating'} event ${slug}:${key}`)
        return new Promise((resolve, reject) => {
            this.collection.findOneAndUpdate({
                slug: slug,
                key: key
            }, {
                $set: updates
            }, {
                upsert: upsert,
		        returnOriginal: false
            }, (err, result) => {
                if (err) {
                    reject(err)
                } else {
                    delete result.value._id
                    resolve(result.value)
                }
            })
        })
    }
    
    fetch(before, after) {
        return new Promise((resolve, reject) => {
            let query = {}
            
            if (before || after) {
                if (before) {
                    query.$lte = new Date(before).getTime()
                }
                if (after) {
                    query.$gte = new Date(after).getTime()
                }
            } else {
                query.$lte = Date.now() + this.interval
            }
            
            this.collection.find({
                run_at: query
            }).toArray((err, events) => {
                if (err) return reject(err)
                else return resolve(events.map(e => {
                    delete e._id
                    return e
                }))
            })
        })
    }
    
    _fetch() {
        return new Promise((resolve, reject) => {
            this
                .fetch()
                .then(events => {
                    if (this.v) console.log(`Dispatching ${events.length} events`)
                    let now = Date.now()
                    events.forEach(e => {
                        this.dispatchAt(e, e.run_at - now)
                    })
                })
                .catch(reject)
        })
    }
    
    _init() {
        this.collection.createIndexes([
            {
                name: 'index-unique-event',
                unique: true,
                key: {
                    slug: 1,
                    key: 1
                }
            },
            {
                name: 'index-reverse-cron',
                key: {
                    run_at: -1
                }
            }
        ], (err, result) => {
            if (err) throw err
            this._fetch()
            this.__timer = setInterval(()=>{this._fetch()}, this.interval)
        })
    }
}

module.exports = Scheduler
