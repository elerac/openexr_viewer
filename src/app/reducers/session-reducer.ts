import { cloneViewerSessionState } from '../../session-state';
import { createInteractionState } from '../../view-state';
import { selectActiveSession } from '../viewer-app-selectors';
import {
  buildResetSessionState,
  buildSwitchedSessionState,
  createClearedViewerState
} from '../session-resource';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import { patchSessionState, type ViewerReducerContext } from './shared';

export function sessionReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  _context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'sessionLoaded': {
      const shouldActivate = intent.activate !== false || !selectActiveSession(state);
      if (!shouldActivate) {
        return {
          ...state,
          sessions: [...state.sessions, intent.session]
        };
      }

      return {
        ...state,
        sessions: [...state.sessions, intent.session],
        activeSessionId: intent.session.id,
        sessionState: cloneViewerSessionState(intent.session.state),
        interactionState: createInteractionState(intent.session.state)
      };
    }
    case 'sessionReloaded': {
      const exists = state.sessions.find((session) => session.id === intent.sessionId);
      if (!exists) {
        return state;
      }

      const sessions = state.sessions.map((session) => (session.id === intent.sessionId ? intent.session : session));
      if (state.activeSessionId !== intent.sessionId) {
        return {
          ...state,
          sessions
        };
      }

      return {
        ...state,
        sessions,
        sessionState: cloneViewerSessionState(intent.session.state),
        interactionState: createInteractionState(intent.session.state)
      };
    }
    case 'sessionDisplayNameChanged': {
      const displayName = intent.displayName.trim();
      if (!displayName) {
        return state;
      }

      const session = state.sessions.find((item) => item.id === intent.sessionId);
      if (!session || session.displayName === displayName) {
        return state;
      }

      return {
        ...state,
        sessions: state.sessions.map((item) => {
          return item.id === intent.sessionId
            ? {
                ...item,
                displayName,
                displayNameIsCustom: true
              }
            : item;
        })
      };
    }
    case 'activeSessionSwitched': {
      const nextSession = state.sessions.find((session) => session.id === intent.sessionId);
      if (!nextSession || state.activeSessionId === nextSession.id) {
        return state;
      }

      const nextSessionState = buildSwitchedSessionState(
        nextSession,
        state.sessionState,
        selectActiveSession(state)?.decoded ?? null,
        {
          autoFitViewport: state.autoFitImageOnSelect ? intent.viewport ?? null : null,
          autoFitInsets: state.autoFitImageOnSelect ? intent.fitInsets ?? null : null
        }
      );
      return {
        ...state,
        activeSessionId: nextSession.id,
        sessionState: nextSessionState,
        interactionState: createInteractionState(nextSessionState)
      };
    }
    case 'sessionsReordered': {
      if (state.sessions.length <= 1) {
        return state;
      }

      const draggedIndex = state.sessions.findIndex((session) => session.id === intent.draggedSessionId);
      if (draggedIndex < 0) {
        return state;
      }

      const remaining = [...state.sessions];
      const [draggedSession] = remaining.splice(draggedIndex, 1);
      if (!draggedSession) {
        return state;
      }

      const targetIndex = remaining.findIndex((session) => session.id === intent.targetSessionId);
      if (targetIndex < 0) {
        return state;
      }

      const insertionIndex = intent.placement === 'before' ? targetIndex : targetIndex + 1;
      const reordered = [...remaining];
      reordered.splice(insertionIndex, 0, draggedSession);
      return {
        ...state,
        sessions: reordered
      };
    }
    case 'sessionClosed': {
      const removeIndex = state.sessions.findIndex((session) => session.id === intent.sessionId);
      if (removeIndex < 0) {
        return state;
      }

      const removingActive = state.activeSessionId === intent.sessionId;
      const removedSession = state.sessions[removeIndex] ?? null;
      const remainingSessions = state.sessions.filter((session) => session.id !== intent.sessionId);

      if (!removingActive) {
        return {
          ...state,
          sessions: remainingSessions
        };
      }

      if (remainingSessions.length === 0) {
        const cleared = createClearedViewerState(state.defaultColormapId);
        return {
          ...state,
          sessions: [],
          activeSessionId: null,
          sessionState: cleared,
          interactionState: createInteractionState(cleared)
        };
      }

      const nextIndex = Math.min(removeIndex, remainingSessions.length - 1);
      const nextSession = remainingSessions[nextIndex];
      if (!nextSession) {
        return state;
      }

      const nextSessionState = buildSwitchedSessionState(
        nextSession,
        state.sessionState,
        removedSession?.decoded ?? null
      );
      return {
        ...state,
        sessions: remainingSessions,
        activeSessionId: nextSession.id,
        sessionState: nextSessionState,
        interactionState: createInteractionState(nextSessionState)
      };
    }
    case 'allSessionsClosed': {
      const cleared = createClearedViewerState(state.defaultColormapId);
      return {
        ...state,
        sessions: [],
        activeSessionId: null,
        sessionState: cleared,
        interactionState: createInteractionState(cleared)
      };
    }
    case 'activeSessionReset': {
      const nextSessionState = buildResetSessionState(
        selectActiveSession(state),
        state.sessionState,
        state.defaultColormapId,
        intent.viewport,
        intent.fitInsets
      );
      return patchSessionState(state, nextSessionState, {
        syncInteractionView: true,
        clearHover: true,
        resetDisplayRangeContext: true
      });
    }
    default:
      return state;
  }
}
