/**
 * Structured logger utility.
 * Provides consistent log formatting with context for traceability.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 1;

function formatLog(level, component, message, context) {
  const timestamp = new Date().toISOString();
  let contextStr = '';
  if (context) {
    if (context instanceof Error) {
      contextStr = ` ${context.stack || context.message}`;
    } else if (typeof context === 'object') {
      try {
        contextStr = Object.keys(context).length > 0 ? ' ' + JSON.stringify(context) : '';
      } catch (e) {
        contextStr = ` ${context}`;
      }
    } else {
      contextStr = ` ${context}`;
    }
  }
  const msgStr = message instanceof Error ? (message.stack || message.message) : (message ?? '');
  return `[${timestamp}] [${level.toUpperCase()}] [${component}] ${msgStr}${contextStr}`;
}

export const logger = {
  debug(component, message, context) {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log(formatLog('debug', component, message, context));
    }
  },
  info(component, message, context) {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(formatLog('info', component, message, context));
    }
  },
  warn(component, message, context) {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', component, message, context));
    }
  },
  error(component, message, context) {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error(formatLog('error', component, message, context));
    }
  },
};

export default logger;
