import { _renderHijack, _rollFunctions } from './ac5e-hooks.mjs';
import { _autoRanged, _autoArmor, _activeModule, _getDistance, _raceOrType, _canSee } from './ac5e-helpers.mjs';
import Settings from './ac5e-settings.mjs';

Hooks.once('init', ac5eRegisterSettings);
Hooks.once('ready', ac5eReady);

/* SETUP FUNCTIONS */
function ac5eRegisterSettings() {
	return new Settings().registerSettings();
}

function ac5eReady() {
	if (_activeModule('midi-qol')) {
		Hooks.once('midi-qol.midiReady', ac5eSetup); //added midi-qol ready hook, so that ac5e registers hooks after MidiQOL.
	} else {
		ac5eSetup();
	}
}

function ac5eSetup() {
	const settings = new Settings();
	const hooksRegistered = {};
	const actionHooks = [
		//abilityChecks
		{ id: 'dnd5e.preRollAbilityCheckV2', type: 'check' },
		{ id: 'dnd5e.preRollAttackV2', type: 'attack' },
		{ id: 'dnd5e.preRollDamageV2', type: 'damage' },
		// { id: 'dnd5e.preRollInitiative', type: 'init' }, //@to-do, double check if it is needed (using the actor.rollInitiative() probably)
		{ id: 'dnd5e.preRollSavingThrowV2', type: 'save' },
		{ id: 'dnd5e.preUseActivity', type: 'activity' },
	];
	const renderHooks = [
		//renders
		{ id: 'dnd5e.renderChatMessage', type: 'chat' },
		//'renderAttackRollConfigurationDialog',  //@to-do, double check if it is needed
		{ id: 'renderD20RollConfigurationDialog', type: 'd20Dialog' },
		{ id: 'renderDamageRollConfigurationDialog', type: 'damageDialog' },
	];
	for (const hook of actionHooks.concat(renderHooks)) {
		const hookId = Hooks.on(hook.id, (...args) => {
			if (renderHooks.some((h) => h.id === hook.id)) {
				const [render, element] = args;
				if (settings.debug) console.warn(hook.id, { render, element });
				return _renderHijack(hook.type, ...args);
			} else {
				if (hook.id === 'dnd5e.preUseActivity') {
					const [activity, config, dialog, message] = args;
					if (settings.debug) console.warn(hook.id, { activity, config, dialog, message });
				} else {
					const [config, dialog, message] = args;
					if (settings.debug) console.warn(hook.id, { config, dialog, message });
				}
				return _rollFunctions(hook.type, ...args);
			}
		});
		hooksRegistered[hook.id] = hookId;
	}
	console.warn('Automated Conditions 5e added the following (mainly) dnd5e hooks:', hooksRegistered);
	globalThis['ac5e'] = { moduleName: 'Automated Conditions 5e' };
	globalThis['ac5e'].hooksRegistered = hooksRegistered;
	globalThis['ac5e'].autoRanged = _autoRanged;
	globalThis['ac5e'].autoarmor = _autoArmor;
	globalThis['ac5e'].canSee = _canSee;
	globalThis['ac5e'].raceOrType = _raceOrType;
	globalThis['ac5e'].getDistance = _getDistance;
}
