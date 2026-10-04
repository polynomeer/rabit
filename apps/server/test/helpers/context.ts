import { createContext, type AppContext } from '../../src/app/context.js';
import { loadConfig } from '../../src/platform/config.js';
import { createLogger } from '../../src/platform/logger.js';

export function testContext(): AppContext {
  const config = loadConfig();
  return createContext(config, createLogger({ level: 'silent', name: 'test' }));
}
