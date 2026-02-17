import { _autoRanged, _autoArmor, _activeModule, _buildFlagRegistry, _createEvaluationSandbox, checkNearby, _generateAC5eFlags, _getDistance, _getItemOrActivity, _inspectFlagRegistry, _raceOrType, _reindexFlagRegistryActor, _canSee } from './ac5e-helpers.mjs';
import { _renderHijack, _renderSettings, _rollFunctions, _overtimeHazards } from './ac5e-hooks.mjs';
import { _migrate } from './ac5e-migrations.mjs';
import { _gmCombatCadenceUpdate, _gmDocumentUpdates, _gmEffectDeletions } from './ac5e-queries.mjs';
import { _initStatusEffectsTables, _syncCombatCadenceFlags, clearStatusEffectOverrides, listStatusEffectOverrides, registerStatusEffectOverride, removeStatusEffectOverride, resetCadenceFlags } from './ac5e-setpieces.mjs';
import Constants from './ac5e-constants.mjs';
import Settings from './ac5e-settings.mjs';
export let scopeUser, lazySandbox, ac5eQueue, statusEffectsTables;
let daeFlags;

Hooks.once('init', ac5eRegisterOnInit);
Hooks.once('i18nInit', ac5ei18nInit);
Hooks.once('ready', ac5eReady);

/* SETUP FUNCTIONS */
function ac5eRegisterOnInit() {
	registerQueries();
	daeFlags = _generateAC5eFlags();
	Hooks.on('dae.setFieldData', (fieldData) => {
		fieldData['AC5E'] = daeFlags;
	});
	scopeUser = game.version > 13 ? 'user' : 'client';
	patchApplyDamage();
	return new Settings().registerSettings();
}

function patchApplyDamage() {
	const proto = CONFIG.Actor?.documentClass?.prototype;

	function getMessageIdFromUI() {
		return globalThis.event?.currentTarget?.closest?.('[data-message-id]')?.dataset?.messageId ?? globalThis.event?.target?.closest?.('[data-message-id]')?.dataset?.messageId ?? document.activeElement?.closest?.('[data-message-id]')?.dataset?.messageId ?? null;
	}

	function wrapper(wrapped, damages, options = {}, ...rest) {
		if (!options?.messageId) {
			const mid = getMessageIdFromUI();
			if (mid) options = { ...options, messageId: mid };
		}
		return wrapped(damages, options, ...rest);
	}

	if (globalThis.libWrapper) {
		try {
			libWrapper.register(Constants.MODULE_ID, 'CONFIG.Actor.documentClass.prototype.applyDamage', wrapper, 'WRAPPER');
			console.log(`${Constants.MODULE_NAME} | Wrapped Actor.applyDamage via libWrapper`);
			return;
		} catch (err) {
			console.warn(`${Constants.MODULE_NAME} | libWrapper failed, falling back to monkeypatch`, err);
		}
	}
	// Fallback monkeypatch
	const original = proto.applyDamage;
	proto.applyDamage = function (damages, options = {}, ...rest) {
		if (!options?.messageId) {
			const mid = getMessageIdFromUI();
			if (mid) options = { ...options, messageId: mid };
		}
		return original.call(this, damages, options, ...rest);
	};
	proto.applyDamage.__ac5e_original__ = original;
	return console.log(`${Constants.MODULE_NAME} | Monkeypatched Actor.applyDamage (no libWrapper)`);
}

function ac5ei18nInit() {
	const settings = new Settings();
	if (settings.displayOnly5eStatuses) {
		const basic = Object.values(CONFIG.DND5E.conditionTypes)
			.filter((e) => !e.pseudo)
			.map((e) => e.name.toLowerCase())
			.concat(['burning', 'suffocation']);
		CONFIG.statusEffects.forEach((effect) => {
			if (!basic.includes(effect.id)) effect.hud = false;
		});
	}
}

function ac5eReady() {
	ac5eQueue = new foundry.utils.Semaphore();
	if (_activeModule('midi-qol')) {
		Hooks.once('midi-qol.midiReady', ac5eSetup); //added midi-qol ready hook, so that ac5e registers hooks after MidiQOL.
	} else {
		ac5eSetup();
	}
	if (_activeModule('dae')) DAE.addAutoFields(daeFlags);
	_migrate();
}

function ac5eSetup() {
	const settings = new Settings();
	initializeSandbox();
	statusEffectsTables = _initStatusEffectsTables();
	const hooksRegistered = {};
	const actionHooks = [
		// { id: 'dnd5e.activityConsumption', type: 'consumptionHook' }, //@to-do: validate that there isn't an actual need for this
		{ id: 'dnd5e.preConfigureInitiative', type: 'init' }, //needed for Combat Carousel at least, when using the actor.rollInitiative()
		{ id: 'dnd5e.preRollAbilityCheck', type: 'check' },
		{ id: 'dnd5e.preRollAttack', type: 'attack' },
		{ id: 'dnd5e.preRollDamage', type: 'damage' },
		{ id: 'dnd5e.preRollSavingThrow', type: 'save' },
		{ id: 'dnd5e.preUseActivity', type: 'use' },
		{ id: 'dnd5e.postUseActivity', type: 'postUse' },
	];
	const buildHooks = [
		{ id: 'dnd5e.buildRollConfig', type: 'buildRoll' },
		{ id: 'dnd5e.postRollConfiguration', type: 'postRollConfig' },
	];
	const foundryHooks = [
		{ id: 'preCreateItem', type: 'preCreateItem' },
	]
	const renderHooks = [
		//renders
		{ id: 'dnd5e.renderChatMessage', type: 'chat' },
		//'renderAttackRollConfigurationDialog',  //@to-do, double check if it is needed
		{ id: 'renderD20RollConfigurationDialog', type: 'd20Dialog' },
		{ id: 'renderDamageRollConfigurationDialog', type: 'damageDialog' },
	];
	for (const hook of actionHooks.concat(renderHooks).concat(foundryHooks).concat(buildHooks)) {
		const hookId = Hooks.on(hook.id, (...args) => {
			if (renderHooks.some((h) => h.id === hook.id)) {
				const [render, element] = args;
				if (settings.debug) console.warn(hook.id, { render, element });
				return _renderHijack(hook.type, ...args);
			} else {
				if (hook.id === 'dnd5e.preUseActivity') {
					const [activity, config, dialog, message] = args;
					if (settings.debug) console.warn(hook.id, { activity, config, dialog, message });
				} else if (hook.id === 'dnd5e.postUseActivity') {
					const [activity, usageConfig, results] = args;
					if (settings.debug) console.warn(hook.id, { activity, usageConfig, results });
				} else if (hook.id === 'dnd5e.preConfigureInitiative') {
					const [actor, rollConfig] = args;
					if (settings.debug) console.warn(hook.id, { actor, rollConfig });
				} else if (hook.id === 'dnd5e.postRollConfiguration') {
					const [rolls, config, dialog, message] = args;
					if (settings.debug) console.warn(hook.id, { rolls, config, dialog, message });
				} else if (hook.id.startsWith('dnd5e.build')) {
					const [app, config, formData, index] = args;
					if (settings.debug) console.warn(hook.id, { app, config, formData, index });
				} else if (hook.id === 'preCreateItem') {
					const [item, updates] = args;
					if (settings.debug) console.warn(hook.id, { item, updates });
				} else {
					const [config, dialog, message] = args;
					if (settings.debug) console.warn(hook.id, { config, dialog, message });
				}
				return _rollFunctions(hook.type, ...args);
			}
		});
		hooksRegistered[hook.id] = hookId;
	}
	const renderSettingsConfigID = Hooks.on('renderSettingsConfig', _renderSettings);
	hooksRegistered['renderSettingsConfig'] = renderSettingsConfigID;
	const combatCadenceHookID = Hooks.on('updateCombat', _syncCombatCadenceFlags);
	hooksRegistered['updateCombat.cadence'] = combatCadenceHookID;
	const combatUpdateHookID = Hooks.on('updateCombat', _overtimeHazards);
	hooksRegistered['updateCombat.hazards'] = combatUpdateHookID;

	const registryUpdateHooks = ['createActor', 'updateActor', 'deleteActor', 'createItem', 'updateItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect'];
	for (const hookName of registryUpdateHooks) {
		const registryHookId = Hooks.on(hookName, (document) => _reindexFlagRegistryActor(document));
		hooksRegistered[hookName] = registryHookId;
	}
	_buildFlagRegistry();

	console.warn('Automated Conditions 5e added the following (mainly) dnd5e hooks:', hooksRegistered);
	globalThis[Constants.MODULE_NAME_SHORT] = {};
	globalThis[Constants.MODULE_NAME_SHORT].info = { moduleName: Constants.MODULE_NAME, hooksRegistered, version: game.modules.get(Constants.MODULE_ID).version };
	globalThis[Constants.MODULE_NAME_SHORT].checkArmor = _autoArmor;
	globalThis[Constants.MODULE_NAME_SHORT].checkCreatureType = _raceOrType;
	globalThis[Constants.MODULE_NAME_SHORT].checkDistance = _getDistance;
	globalThis[Constants.MODULE_NAME_SHORT].checkNearby = checkNearby;
	globalThis[Constants.MODULE_NAME_SHORT].checkRanged = _autoRanged;
	globalThis[Constants.MODULE_NAME_SHORT].checkVisibility = _canSee;
	globalThis[Constants.MODULE_NAME_SHORT].evaluationData = _createEvaluationSandbox;
	globalThis[Constants.MODULE_NAME_SHORT].getItemOrActivity = _getItemOrActivity;
	globalThis[Constants.MODULE_NAME_SHORT].logEvaluationData = false;
	globalThis[Constants.MODULE_NAME_SHORT].debugEvaluations = false;
	globalThis[Constants.MODULE_NAME_SHORT].debugOptins = false;
	globalThis[Constants.MODULE_NAME_SHORT].flagRegistry = {
		rebuild: _buildFlagRegistry,
		reindexActor: _reindexFlagRegistryActor,
		inspect: _inspectFlagRegistry,
	};
	Object.defineProperty(globalThis[Constants.MODULE_NAME_SHORT], '_target', {
		get() {
			return game?.user?.targets?.first();
		},
		configurable: true,
	});
	globalThis[Constants.MODULE_NAME_SHORT].statusEffectsTables = statusEffectsTables;
	globalThis[Constants.MODULE_NAME_SHORT].statusEffectsOverrides = {
		register: registerStatusEffectOverride,
		remove: removeStatusEffectOverride,
		clear: clearStatusEffectOverrides,
		list: listStatusEffectOverrides,
	};
	globalThis[Constants.MODULE_NAME_SHORT].cadence = {
		reset: resetCadenceFlags,
	};
	globalThis[Constants.MODULE_NAME_SHORT].troubleshooter = {
		snapshot: createTroubleshooterSnapshot,
		exportSnapshot: exportTroubleshooterSnapshot,
		importSnapshot: importTroubleshooterSnapshot,
	};
	Hooks.callAll('ac5e.statusEffectsReady', {
		tables: statusEffectsTables,
		overrides: globalThis[Constants.MODULE_NAME_SHORT].statusEffectsOverrides,
	});
}

function initializeSandbox() {
	const { DND5E } = CONFIG;

	const safeConstants = foundry.utils.deepFreeze({
		abilities: Object.fromEntries(Object.keys(DND5E.abilities).map((k) => [k, false])),
		abilityConsumptionTypes: Object.fromEntries(Object.keys(DND5E.abilityConsumptionTypes).map((k) => [k, false])),
		activityActivationTypes: Object.fromEntries(Object.keys(DND5E.activityActivationTypes).map((k) => [k, false])),
		activityConsumptionTypes: Object.fromEntries(Object.keys(DND5E.activityConsumptionTypes).map((k) => [k, false])),
		activityTypes: Object.fromEntries(Object.keys(DND5E.activityTypes).map((k) => [k, false])),
		actorSizes: Object.fromEntries(Object.keys(DND5E.actorSizes).map((k) => [k, false])),
		alignments: Object.fromEntries(Object.keys(DND5E.alignments).map((k) => [k, false])),
		ammoIds: Object.fromEntries(Object.keys(DND5E.ammoIds).map((k) => [k, false])),
		areaTargetTypes: Object.fromEntries(Object.keys(DND5E.areaTargetTypes).map((k) => [k, false])),
		armorIds: Object.fromEntries(Object.keys(DND5E.armorIds).map((k) => [k, false])),
		armorProficiencies: Object.fromEntries(Object.keys(DND5E.armorProficiencies).map((k) => [k, false])),
		armorTypes: Object.fromEntries(Object.keys(DND5E.armorTypes).map((k) => [k, false])),
		attackClassifications: Object.fromEntries(Object.keys(DND5E.attackClassifications).map((k) => [k, false])),
		attackModes: Object.fromEntries(Object.keys(DND5E.attackModes).map((k) => [k, false])),
		attackTypes: Object.fromEntries(Object.keys(DND5E.attackTypes).map((k) => [k, false])),
		conditionTypes: Object.fromEntries(
			Object.keys(DND5E.conditionTypes)
				.concat('bloodied')
				.map((k) => [k, false])
		),
		creatureTypes: Object.fromEntries(Object.keys(DND5E.creatureTypes).map((k) => [k, false])),
		damageTypes: Object.fromEntries(Object.keys(DND5E.damageTypes).map((k) => [k, false])),
		healingTypes: Object.fromEntries(Object.keys(DND5E.healingTypes).map((k) => [k, false])),
		itemActionTypes: Object.fromEntries(Object.keys(DND5E.itemActionTypes).map((k) => [k, false])),
		itemProperties: Object.fromEntries(Object.keys(DND5E.itemProperties).map((k) => [k, false])),
		skills: Object.fromEntries(Object.keys(DND5E.skills).map((k) => [k, false])),
		toolIds: Object.fromEntries(Object.keys(DND5E.toolIds).map((k) => [k, false])),
		toolProficiencies: Object.fromEntries(Object.keys(DND5E.toolProficiencies).map((k) => [k, false])),
		tools: Object.fromEntries(Object.keys(DND5E.tools).map((k) => [k, false])),
		spellSchools: Object.fromEntries(Object.keys(DND5E.spellSchools).map((k) => [k, false])),
		statusEffects: Object.fromEntries(Object.keys(DND5E.statusEffects).map((k) => [k, false])),
		weaponMasteries: Object.fromEntries(Object.keys(DND5E.weaponMasteries).map((k) => [k, false])),
		weaponIds: Object.fromEntries(Object.keys(DND5E.weaponIds).map((k) => [k, false])),
	});

	const flatConstants = Object.assign({}, ...Object.values(safeConstants).filter((v) => typeof v === 'object'));
	foundry.utils.deepFreeze(flatConstants);
	const safeHelpers = Object.freeze({
		checkNearby,
		checkVisibility: _canSee,
		checkDistance: _getDistance,
		checkCreatureType: _raceOrType,
		getItemOrActivity: _getItemOrActivity,
		checkArmor: _autoArmor,
		checkRanged: _autoRanged,
	});

	lazySandbox = foundry.utils.deepFreeze({
		CONSTANTS: safeConstants,
		_flatConstants: flatConstants,
		...safeHelpers,
		Math,
		Number,
		String,
		Boolean,
		Array,
		Object,
		JSON,
		Date,
	});

	console.log('AC5E Base sandbox initialized', lazySandbox);
}

function registerQueries() {
	CONFIG.queries[Constants.MODULE_ID] = {};
	CONFIG.queries[Constants.GM_DOCUMENT_UPDATES] = _gmDocumentUpdates;
	CONFIG.queries[Constants.GM_EFFECT_DELETIONS] = _gmEffectDeletions;
	CONFIG.queries[Constants.GM_COMBAT_CADENCE_UPDATE] = _gmCombatCadenceUpdate;
}

function _safeGetSetting(namespace, key) {
	try {
		return game.settings.get(namespace, key);
	} catch (_err) {
		return null;
	}
}

function _enumKeyByValue(enumObject, value) {
	if (!enumObject || value === undefined || value === null) return null;
	const match = Object.entries(enumObject).find(([, enumValue]) => enumValue === value);
	return match?.[0] ?? null;
}

function _collectModuleSettings(namespace) {
	const settings = {};
	for (const setting of game.settings.settings.values()) {
		if (setting?.namespace !== namespace) continue;
		const settingKey = setting?.key;
		if (!settingKey) continue;
		settings[settingKey] = _safeGetSetting(namespace, settingKey);
	}
	return settings;
}

function _getModuleState(moduleId) {
	const module = game.modules?.get(moduleId);
	return {
		id: moduleId,
		active: Boolean(module?.active),
		version: module?.version ?? null,
		title: module?.title ?? null,
	};
}

function _formatTroubleshooterFilename(date = new Date()) {
	const pad = (n) => `${n}`.padStart(2, '0');
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hour = pad(date.getHours());
	const minute = pad(date.getMinutes());
	const second = pad(date.getSeconds());
	return `ac5e-troubleshooter-${year}${month}${day}-${hour}${minute}${second}.json`;
}

export function createTroubleshooterSnapshot() {
	const gridDiagonalsValue = _safeGetSetting('core', 'gridDiagonals');
	const rulesVersion = _safeGetSetting('dnd5e', 'rulesVersion');
	const scene = canvas?.scene ?? null;
	const grid = canvas?.grid ?? null;
	const environment = scene?.environment?.toObject?.() ?? foundry.utils.duplicate(scene?.environment ?? {});

	return {
		schema: 1,
		generatedAt: new Date().toISOString(),
		user: {
			id: game.user?.id ?? null,
			name: game.user?.name ?? null,
			role: game.user?.role ?? null,
			isGM: Boolean(game.user?.isGM),
		},
		versions: {
			foundry: game.version ?? null,
			foundryGeneration: game.release?.generation ?? null,
			system: {
				id: game.system?.id ?? null,
				version: game.system?.version ?? null,
			},
			modules: {
				ac5e: _getModuleState(Constants.MODULE_ID),
				midiQOL: _getModuleState('midi-qol'),
				dae: _getModuleState('dae'),
				timesUp: _getModuleState('times-up'),
				chrisPremades: _getModuleState('chris-premades'),
			},
		},
		ac5e: {
			settings: _collectModuleSettings(Constants.MODULE_ID),
		},
		canvas: {
			scene: {
				id: scene?.id ?? null,
				uuid: scene?.uuid ?? null,
				name: scene?.name ?? null,
				tokenVision: scene?.tokenVision ?? null,
				environment,
				globalLightEnabled: scene?.environment?.globalLight?.enabled ?? null,
			},
			grid: {
				type: grid?.type ?? null,
				typeName: _enumKeyByValue(CONST.GRID_TYPES, grid?.type),
				diagonals: gridDiagonalsValue,
				diagonalsName: _enumKeyByValue(CONST.GRID_DIAGONALS, gridDiagonalsValue),
				distance: grid?.distance ?? null,
				units: grid?.units ?? null,
				size: grid?.size ?? null,
			},
		},
		dnd5e: {
			rulesVersion,
		},
	};
}

export function exportTroubleshooterSnapshot({ filename = null } = {}) {
	const snapshot = createTroubleshooterSnapshot();
	const json = JSON.stringify(snapshot, null, 2);
	const targetFile = filename || _formatTroubleshooterFilename();
	foundry.utils.saveDataToFile(json, 'application/json', targetFile);
	return snapshot;
}

function readTextFromFile(file) {
	const reader = new FileReader();
	return new Promise((resolve, reject) => {
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => {
			reader.abort();
			reject(new Error('Unable to read file'));
		};
		reader.readAsText(file);
	});
}

function pickTroubleshooterSnapshotFile() {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.style.display = 'none';
		input.addEventListener(
			'change',
			() => {
				const [file] = Array.from(input.files ?? []);
				input.remove();
				resolve(file ?? null);
			},
			{ once: true }
		);
		document.body.appendChild(input);
		input.click();
	});
}

export async function importTroubleshooterSnapshot(file = null) {
	const importFile = file ?? (await pickTroubleshooterSnapshotFile());
	if (!importFile) return null;
	const text = await (foundry.utils.readTextFromFile?.(importFile) ?? readTextFromFile(importFile));
	const parsed = JSON.parse(text);
	console.log('AC5E troubleshooter import:', parsed);
	return parsed;
}
