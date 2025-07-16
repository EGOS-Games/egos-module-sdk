const winston = require('winston');

/**
 * Enhanced logging configuration for EGOS modules
 * Provides structured logging with component-specific levels
 */

const createLogger = (options = {}) => {
    const defaultOptions = {
        level: process.env.LOG_LEVEL || 'debug',
        component: options.component || 'module',
        enableFile: options.enableFile !== false,
        logDir: options.logDir || './logs',
        maxFiles: options.maxFiles || 10,
        maxSize: options.maxSize || '10m'
    };

    const formats = [
        winston.format.timestamp(),
        winston.format.errors({ stack: true })
    ];

    // Add component name to logs
    if (defaultOptions.component) {
        formats.push(winston.format.label({ label: defaultOptions.component }));
    }

    const transports = [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, label, ...meta }) => {
                    let logMessage = `${timestamp} [${label || 'module'}] ${level}: ${message}`;
                    if (Object.keys(meta).length > 0) {
                        logMessage += ` ${JSON.stringify(meta)}`;
                    }
                    return logMessage;
                })
            )
        })
    ];

    // Add file transports if enabled
    if (defaultOptions.enableFile) {
        transports.push(
            new winston.transports.File({
                filename: `${defaultOptions.logDir}/error.log`,
                level: 'error',
                format: winston.format.json(),
                maxsize: defaultOptions.maxSize,
                maxFiles: defaultOptions.maxFiles
            }),
            new winston.transports.File({
                filename: `${defaultOptions.logDir}/combined.log`,
                format: winston.format.json(),
                maxsize: defaultOptions.maxSize,
                maxFiles: defaultOptions.maxFiles
            })
        );
    }

    return winston.createLogger({
        level: defaultOptions.level,
        format: winston.format.combine(...formats),
        transports
    });
};

// Default logger instance
const logger = createLogger();

module.exports = { 
    logger, 
    createLogger 
};
