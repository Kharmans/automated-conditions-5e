import { ac5eQueue } from './ac5e-main.mjs';
import Constants from './ac5e-constants.mjs';
const CADENCE_FLAG_KEY = 'cadence';

function _resolveUuidString(value) {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : null;
	}
	if (value && typeof value === 'object') {
		const nestedUuid = value.uuid ?? value.document?.uuid ?? value.context?.uuid;
		if (typeof nestedUuid === 'string') {
			const trimmedNested = nestedUuid.trim();
			return trimmedNested.length ? trimmedNested : null;
		}
	}
	return null;
}

function _safeFromUuidSync(value) {
	const uuid = _resolveUuidString(value);
	if (!uuid) return null;
	try {
		return fromUuidSync(uuid) ?? null;
	} catch (err) {
		console.warn('AC5E safe UUID resolver failed', { uuid, value, err });
		return null;
	}
}

export async function _doQueries({ validActivityUpdatesGM = [], validActorUpdatesGM = [], validEffectDeletionsGM = [], validEffectUpdatesGM = [], validItemUpdatesGM = [] } = {}) {
	const activeGM = game.users.activeGM;
	if (!activeGM) return false;
	try {
		if (validEffectDeletionsGM.length) {
			await activeGM.query(Constants.GM_EFFECT_DELETIONS, { validEffectDeletionsGM });
		}
		if (validActivityUpdatesGM.length || validActorUpdatesGM.length || validEffectUpdatesGM.length || validItemUpdatesGM.length) {
			await activeGM.query(Constants.GM_DOCUMENT_UPDATES, { validActivityUpdatesGM, validActorUpdatesGM, validEffectUpdatesGM, validItemUpdatesGM });
		}
		return true;
	} catch (err) {
		console.error('doQueries failed:', err);
		return false;
	}
}

export async function _setCombatCadenceFlag({ combatUuid, state } = {}) {
	if (!combatUuid || !state) return false;
	const activeGM = game.users.activeGM;
	if (!activeGM) return false;
	try {
		if (activeGM.id === game.user?.id) {
			const combat = _safeFromUuidSync(combatUuid);
			if (!combat) return false;
			await combat.unsetFlag(Constants.MODULE_ID, CADENCE_FLAG_KEY);
			await combat.setFlag(Constants.MODULE_ID, CADENCE_FLAG_KEY, state);
			return true;
		}
		await activeGM.query(Constants.GM_COMBAT_CADENCE_UPDATE, { combatUuid, state });
		return true;
	} catch (err) {
		console.error('setCombatCadenceFlag failed:', err);
		return false;
	}
}

export async function _setContextKeywordsSetting({ state } = {}) {
	if (!state || typeof state !== 'object') return false;
	const activeGM = game.users.activeGM;
	if (!activeGM) return false;
	try {
		if (activeGM.id === game.user?.id) {
			await game.settings.set(Constants.MODULE_ID, 'contextKeywordsRegistry', state);
			return true;
		}
		await activeGM.query(Constants.GM_CONTEXT_KEYWORDS_UPDATE, { state });
		return true;
	} catch (err) {
		console.error('setContextKeywordsSetting failed:', err);
		return false;
	}
}

export function _gmEffectDeletions({ validEffectDeletionsGM = [] } = {}) {
	const uuids = Array.from(new Set(validEffectDeletionsGM || []));
	if (!uuids.length) return;
	ac5eQueue.add(() => deletions(uuids));
}

async function deletions(uuids = []) {
	const retrieved = uuids.map((uuid) => ({ uuid, doc: _safeFromUuidSync(uuid) }));

	await Promise.all(
		retrieved.map(async ({ uuid, doc }) => {
			if (!doc) return;
			try {
				await doc.delete();
			} catch (err) {
				console.error(`${Constants.GM_EFFECT_DELETIONS} failed to delete ${uuid}:`, err);
			}
		})
	);
}

export function _gmDocumentUpdates({ validActivityUpdatesGM, validActorUpdatesGM, validEffectUpdatesGM, validItemUpdatesGM }) {
	const merged = [...(validActivityUpdatesGM || []), ...(validActorUpdatesGM || []), ...(validEffectUpdatesGM || []), ...(validItemUpdatesGM || [])];
	const byUuid = new Map();
	for (const entry of merged) {
		if (!entry || !entry.uuid) continue;
		byUuid.set(entry.uuid, entry);
	}
	const entries = Array.from(byUuid.values());
	if (!entries.length) return;
	return ac5eQueue.add(() => documentUpdates(entries));
}

export async function _gmCombatCadenceUpdate({ combatUuid, state } = {}) {
	if (!game.user?.isGM) return false;
	if (!combatUuid || !state) return false;
	const combat = _safeFromUuidSync(combatUuid);
	if (!combat) return false;
	try {
		await combat.unsetFlag(Constants.MODULE_ID, CADENCE_FLAG_KEY);
		await combat.setFlag(Constants.MODULE_ID, CADENCE_FLAG_KEY, state);
		return true;
	} catch (err) {
		console.error(`${Constants.GM_COMBAT_CADENCE_UPDATE} failed for ${combatUuid}:`, err);
		return false;
	}
}

export async function _gmContextKeywordsUpdate({ state } = {}) {
	if (!game.user?.isGM) return false;
	if (!state || typeof state !== 'object') return false;
	try {
		await game.settings.set(Constants.MODULE_ID, 'contextKeywordsRegistry', state);
		return true;
	} catch (err) {
		console.error(`${Constants.GM_CONTEXT_KEYWORDS_UPDATE} failed:`, err);
		return false;
	}
}

async function documentUpdates(entries) {
	const mapped = entries.map(({ uuid, updates, options }) => ({ uuid, doc: _safeFromUuidSync(uuid), updates, options }));
	await Promise.all(
		mapped.map(async ({ uuid, doc, updates, options }) => {
			if (!doc) {
				return { uuid, status: 'error', error: 'Document not found' };
			}
			try {
				if (options) await doc.update(updates, options);
				else await doc.update(updates);
			} catch (err) {
				console.error(`${Constants.GM_DOCUMENT_UPDATES} failed to update ${uuid}:`, err);
			}
		})
	);
}
