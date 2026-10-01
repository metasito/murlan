import { jest } from '@jest/globals';
import { fourTricks } from './helpers/pileMounts';

jest.mock('@/components/CardView', () => require('./helpers/pileMounts').cardViewModule());
jest.mock('react-native-reanimated', () => require('./helpers/pileMounts').reanimatedModule());
jest.mock('@/components/table/useFlightClock', () => require('./helpers/pileMounts').flightClockModule());

fourTricks('reduced', 'on');
