import pino from "pino"

type LoggerConfig = {
  level: string
  transport?: {
    target: string
    options: {
      colorize: boolean
      singleLine: boolean
      translateTime: string
    }
  }
}

// Create logger instance for structured logging
const config: LoggerConfig = {
  level: process.env.LOG_LEVEL || "info",
}

if (process.env.NODE_ENV !== "production") {
  config.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      singleLine: false,
      translateTime: "SYS:standard",
    },
  }
}

const logger = pino(config as Parameters<typeof pino>[0])

export { logger }
export default logger

