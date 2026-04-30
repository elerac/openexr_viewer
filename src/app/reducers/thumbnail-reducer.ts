import { buildChannelThumbnailSessionPrefix } from '../../channel-thumbnail-keys';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import { sessionExists, type ViewerReducerContext } from './shared';

export function thumbnailReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'thumbnailRequested':
      return {
        ...state,
        pendingThumbnailTokensBySessionId: {
          ...state.pendingThumbnailTokensBySessionId,
          [intent.sessionId]: intent.token
        }
      };
    case 'thumbnailReady':
      if (state.pendingThumbnailTokensBySessionId[intent.sessionId] !== intent.token) {
        return state;
      }
      return {
        ...state,
        thumbnailsBySessionId: {
          ...state.thumbnailsBySessionId,
          [intent.sessionId]: intent.thumbnailDataUrl
        }
      };
    case 'channelThumbnailRequested':
      return {
        ...state,
        pendingChannelThumbnailTokensByRequestKey: {
          ...state.pendingChannelThumbnailTokensByRequestKey,
          [intent.requestKey]: intent.token
        }
      };
    case 'channelThumbnailReady':
      if (state.pendingChannelThumbnailTokensByRequestKey[intent.requestKey] !== intent.token) {
        return state;
      }
      return {
        ...state,
        channelThumbnailsByRequestKey: {
          ...state.channelThumbnailsByRequestKey,
          [intent.requestKey]: intent.thumbnailDataUrl
        },
        channelThumbnailLatestRequestKeyByContextKey: {
          ...state.channelThumbnailLatestRequestKeyByContextKey,
          [intent.contextKey]: intent.requestKey
        }
      };
    case 'sessionReloaded':
      return sessionExists(context.initialState, intent.sessionId)
        ? {
            ...state,
            ...pruneChannelThumbnailStateForSession(state, intent.sessionId)
          }
        : state;
    case 'sessionClosed':
      return sessionExists(context.initialState, intent.sessionId)
        ? removeThumbnailStateForSession(state, intent.sessionId)
        : state;
    case 'allSessionsClosed':
      return {
        ...state,
        pendingThumbnailTokensBySessionId: {},
        thumbnailsBySessionId: {},
        pendingChannelThumbnailTokensByRequestKey: {},
        channelThumbnailsByRequestKey: {},
        channelThumbnailLatestRequestKeyByContextKey: {}
      };
    default:
      return state;
  }
}

function removeThumbnailStateForSession(state: ViewerAppState, sessionId: string): ViewerAppState {
  const {
    [sessionId]: _removedThumb,
    ...thumbnailsBySessionId
  } = state.thumbnailsBySessionId;
  const {
    [sessionId]: _removedToken,
    ...pendingThumbnailTokensBySessionId
  } = state.pendingThumbnailTokensBySessionId;

  return {
    ...state,
    thumbnailsBySessionId,
    pendingThumbnailTokensBySessionId,
    ...pruneChannelThumbnailStateForSession(state, sessionId)
  };
}

function pruneChannelThumbnailStateForSession(
  state: Pick<
    ViewerAppState,
    | 'pendingChannelThumbnailTokensByRequestKey'
    | 'channelThumbnailsByRequestKey'
    | 'channelThumbnailLatestRequestKeyByContextKey'
  >,
  sessionId: string
): Pick<
  ViewerAppState,
  | 'pendingChannelThumbnailTokensByRequestKey'
  | 'channelThumbnailsByRequestKey'
  | 'channelThumbnailLatestRequestKeyByContextKey'
> {
  const sessionPrefix = buildChannelThumbnailSessionPrefix(sessionId);
  const pendingChannelThumbnailTokensByRequestKey = Object.fromEntries(
    Object.entries(state.pendingChannelThumbnailTokensByRequestKey)
      .filter(([requestKey]) => !requestKey.startsWith(sessionPrefix))
  );
  const channelThumbnailsByRequestKey = Object.fromEntries(
    Object.entries(state.channelThumbnailsByRequestKey)
      .filter(([requestKey]) => !requestKey.startsWith(sessionPrefix))
  );
  const channelThumbnailLatestRequestKeyByContextKey = Object.fromEntries(
    Object.entries(state.channelThumbnailLatestRequestKeyByContextKey)
      .filter(([contextKey]) => !contextKey.startsWith(sessionPrefix))
      .filter(([, requestKey]) => !requestKey.startsWith(sessionPrefix))
  );

  return {
    pendingChannelThumbnailTokensByRequestKey,
    channelThumbnailsByRequestKey,
    channelThumbnailLatestRequestKeyByContextKey
  };
}
