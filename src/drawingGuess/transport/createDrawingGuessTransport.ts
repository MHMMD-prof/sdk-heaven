import { DrawingGuessRouteMode } from '../controller/drawingGuessControllerTypes';
import { LiveKitDrawingGuessTransport } from './LiveKitDrawingGuessTransport';
import { MockDrawingGuessTransport } from './MockDrawingGuessTransport';

export const createDrawingGuessTransport = (mode: DrawingGuessRouteMode = 'local-simulated') =>
  mode === 'online' ? new LiveKitDrawingGuessTransport() : new MockDrawingGuessTransport();
