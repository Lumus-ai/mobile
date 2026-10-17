import { registerPlugin } from '@capacitor/core';
import type { EmbeddedServerPlugin } from './definitions';

const EmbeddedServer = registerPlugin<EmbeddedServerPlugin>('EmbeddedServer');

export * from './definitions';
export { EmbeddedServer };
