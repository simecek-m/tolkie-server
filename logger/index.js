const winston = require("winston");
const { combine, timestamp, colorize, printf } = winston.format;

const format = combine(
  colorize(),
  timestamp(),
  printf(
    log => `${log.timestamp} ${log.level}: ${log.message}`
  )
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format,
  transports: [new winston.transports.Console()],
});

module.exports = logger;
