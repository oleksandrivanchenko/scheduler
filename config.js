 const config = {
  port: Number(process.env.PORT),
  interval: Number(process.env.INTERVAL),
  verbose: process.env.VERBOSE.toLowerCase() === 'true',
  upsert: process.env.UPSERT.toLowerCase() === 'true',
  hash_delimiter: process.env.HASH_DELIMITER,
  workers: process.env.WORKERS,
  retries: process.env.RETRY_COUNT,
  retry_timeout: process.env.RETRY_TIMEOUT,
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    queue_name: process.env.REDIS_QUEUE_NAME,
    ordered_set_name: process.env.REDIS_ORDER_SET_NAME,
  },
  mongo: {
    endpoint: process.env.MONGO_ENDPOINT,
    host: process.env.MONGO_HOST,
    port: Number(process.env.MONGO_PORT),
    db_name: process.env.MONGO_DB,
    collection_name: process.env.MONGO_COLLECTION,
    username: process.env.MONGO_USER,
    password: process.env.MONGO_PASSWORD,
  },
  papertrail: {
    host: process.env.PAPERTTRAIL_HOST,
    port: process.env.PAPERTTRAIL_PORT,
  }
};

const findBadConfigVariable = (obj) => {
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object' && obj[key].constructor === Object) {
      findBadConfigVariable(obj[key]);
    } else if (typeof obj[key] === 'undefined' || (typeof obj[key] === 'number' && Number.isNaN(obj[key]))) {
      throw new Error(`Environment variable ${key} is undefined or configured incorrectly.`);
    }
  }
};

(() => {
  try {
    findBadConfigVariable(config);
  } catch (e) {
    console.error(e);
    throw e;
  }
})();

module.exports = config;