import { _ac5eActorRollData, _ac5eSafeEval, _activeModule, _canSee, _calcAdvantageMode, _createEvaluationSandbox, _dispositionCheck, _getActivityEffectsStatusRiders, _getDistance, _getEffectOriginToken, _getItemOrActivity, _hasAppliedEffects, _hasStatuses, _localize, _i18nConditions, _autoArmor, _autoEncumbrance, _autoRanged, _raceOrType, _staticID } from './ac5e-helpers.mjs';
import { _doQueries } from './ac5e-queries.mjs';
import { ac5eQueue, statusEffectsTables } from './ac5e-main.mjs';
import Constants from './ac5e-constants.mjs';
import Settings from './ac5e-settings.mjs';

const settings = new Settings();
const statusEffectsOverrideState = {
	list: [],
	seq: 1,
};

export function _initStatusEffectsTables() {
	return buildStatusEffectsTables();
}

export function registerStatusEffectOverride(override = {}) {
	// Example:
	// const id = ac5e.statusEffectsOverrides.register({
	//   name: "Minotaur ignores prone melee disadvantage",
	//   status: "prone",
	//   hook: "attack",
	//   type: "subject",
	//   priority: 10,
	//   when: ({ context }) => context.subject?.name === "Minotaur",
	//   apply: ({ result }) => (result === "disadvantage" ? "" : result),
	// });
	// ac5e.statusEffectsOverrides.remove(id);
	const entry = {
		id: override.id ?? `ac5e-status-override-${statusEffectsOverrideState.seq++}`,
		name: override.name ?? undefined,
		priority: Number.isFinite(override.priority) ? override.priority : 0,
		status: override.status ?? '*',
		hook: override.hook ?? '*',
		type: override.type ?? '*',
		when: override.when,
		apply: override.apply,
		result: override.result,
	};
	statusEffectsOverrideState.list.push(entry);
	return entry.id;
}

export function removeStatusEffectOverride(id) {
	const index = statusEffectsOverrideState.list.findIndex((entry) => entry.id === id);
	if (index >= 0) statusEffectsOverrideState.list.splice(index, 1);
	return index >= 0;
}

export function clearStatusEffectOverrides() {
	statusEffectsOverrideState.list.length = 0;
}

export function listStatusEffectOverrides() {
	return statusEffectsOverrideState.list.slice();
}

export function _ac5eChecks({ ac5eConfig, subjectToken, opponentToken }) {
	//ac5eConfig.options {ability, activity, distance, hook, skill, tool, isConcentration, isDeathSave, isInitiative}
	const checksCache = ac5eConfig.options._ac5eHookChecksCache ?? (ac5eConfig.options._ac5eHookChecksCache = {});
	const cacheKey = getChecksCacheKey({ ac5eConfig, subjectToken, opponentToken });
	const canReuseChecks = ac5eConfig?.reEval?.requiresFlagReEvaluation === false;
	if (canReuseChecks && cacheKey && checksCache[cacheKey]) {
		recordChecksReuseStat('hit');
		applyChecksSnapshot(ac5eConfig, checksCache[cacheKey]);
		if (ac5e?.debugGetConfigLayers || ac5e?.debugChecksReuse) {
			console.warn('AC5E checks: reusing cached evaluation', {
				cacheKey,
				hookType: ac5eConfig?.hookType,
				subjectTokenId: subjectToken?.id,
				opponentTokenId: opponentToken?.id,
				stats: ac5e?._checksReuseStats,
			});
		}
		return ac5eConfig;
	}
	if (canReuseChecks) recordChecksReuseStat('miss');
	else recordChecksReuseStat('skip');
	if (ac5e?.debugChecksReuse) {
		console.warn('AC5E checks: evaluating fresh', {
			cacheKey,
			hookType: ac5eConfig?.hookType,
			subjectTokenId: subjectToken?.id,
			opponentTokenId: opponentToken?.id,
			canReuseChecks,
			stats: ac5e?._checksReuseStats,
		});
	}
	if (!foundry.utils.isEmpty(ac5eConfig.subject.forcedAdvantage)) {
		ac5eConfig.subject.advantage = ac5eConfig.subject.forcedAdvantage;
		ac5eConfig.subject.disadvantage = [];
		ac5eConfig.subject.advantageNames = new Set();
		ac5eConfig.subject.disadvantageNames = new Set();
		return ac5eConfig;
	} else if (!foundry.utils.isEmpty(ac5eConfig.subject.forcedDisadvantage)) {
		ac5eConfig.subject.advantage = [];
		ac5eConfig.subject.disadvantage = ac5eConfig.subject.forcedDisadvantage;
		ac5eConfig.subject.advantageNames = new Set();
		ac5eConfig.subject.disadvantageNames = new Set();
		return ac5eConfig;
	}
	const { options } = ac5eConfig;
	const actorTokens = {
		subject: subjectToken?.actor,
		opponent: opponentToken?.actor,
	};

	if (settings.automateStatuses) {
		const tables = statusEffectsTables;
		if (!tables) {
			console.warn('AC5E status effects tables unavailable during check evaluation; skipping status automation for this roll.');
		}
		for (const [type, actor] of Object.entries(actorTokens)) {
			if (!tables) break;
			if (foundry.utils.isEmpty(actor)) continue;
			const isSubjectExhausted = settings.autoExhaustion && type === 'subject' && actor?.statuses.has('exhaustion');
			const exhaustionLvl = isSubjectExhausted && actor.system?.attributes.exhaustion >= 3 ? 3 : 1;
			const context = buildStatusEffectsContext({ ac5eConfig, subjectToken, opponentToken, exhaustionLvl, type });

			for (const status of actor.statuses) {
				if (shouldIgnoreStatus(actor, status)) continue;
				const test = getStatusEffectResult({
					status,
					statusEntry: tables?.[status],
					hook: options.hook,
					type,
					context,
					exhaustionLvl,
					isSubjectExhausted,
				});

				if (!test) continue;
				if (settings.debug) console.log(type, test);
				const effectName = tables?.[status]?.name;
				if (effectName) {
					if (test.includes('advantageNames')) ac5eConfig[type][test].add(effectName);
					else ac5eConfig[type][test].push(effectName);
				}
			}
		}
	}

	ac5eConfig = ac5eFlags({ ac5eConfig, subjectToken, opponentToken });
	if (cacheKey) checksCache[cacheKey] = createChecksSnapshot(ac5eConfig);
	if (settings.debug) console.log('AC5E._ac5eChecks:', { ac5eConfig });
	return ac5eConfig;
}

function recordChecksReuseStat(type) {
	if (!ac5e) return;
	ac5e._checksReuseStats ??= { hits: 0, misses: 0, skips: 0, last: null };
	if (type === 'hit') ac5e._checksReuseStats.hits++;
	if (type === 'miss') ac5e._checksReuseStats.misses++;
	if (type === 'skip') ac5e._checksReuseStats.skips++;
	ac5e._checksReuseStats.last = type;
}

function getChecksCacheKey({ ac5eConfig, subjectToken, opponentToken }) {
	const hookType = ac5eConfig?.hookType ?? ac5eConfig?.options?.hook;
	if (!hookType) return null;
	const subjectTokenId = subjectToken?.id ?? ac5eConfig?.tokenId ?? 'none';
	const opponentTokenId = opponentToken?.id ?? ac5eConfig?.targetId ?? 'none';
	const subjectSignature = getActorContextSignature(subjectToken);
	const opponentSignature = getActorContextSignature(opponentToken);
	const targetsSignature = getTargetsSignature(ac5eConfig?.options?.targets);
	const distance = ac5eConfig?.options?.distance ?? 'none';
	const rollProfileSignature = getRollProfileSignature(ac5eConfig?.options ?? {});
	return `${hookType}:${subjectTokenId}:${opponentTokenId}:${distance}:${targetsSignature}:${subjectSignature}:${opponentSignature}:${rollProfileSignature}`;
}

function getActorContextSignature(token) {
	const actor = token?.actor;
	if (!actor) return 'none';
	const statuses = Array.from(actor.statuses ?? []).sort().join('|');
	const hpValue = actor.system?.attributes?.hp?.value ?? 'na';
	const hpTemp = actor.system?.attributes?.hp?.temp ?? 'na';
	const hpTempMax = actor.system?.attributes?.hp?.tempmax ?? 'na';
	const effects = (actor.appliedEffects ?? [])
		.map((effect) => `${effect?.uuid ?? effect?.id ?? 'effect'}:${Array.from(effect?.statuses ?? []).sort().join(',')}`)
		.sort()
		.join('|');
	return `${actor.uuid ?? actor.id}:${statuses}:${hpValue}:${hpTemp}:${hpTempMax}:${effects}`;
}

function getTargetsSignature(targets) {
	if (!Array.isArray(targets) || !targets.length) return 'none';
	return targets
		.map((target) => target?.tokenUuid ?? target?.uuid ?? target?.id ?? target?.name ?? 'target')
		.sort()
		.join('|');
}

function getRollProfileSignature(options = {}) {
	const profile = {
		ability: options.ability,
		skill: options.skill,
		tool: options.tool,
		attackMode: options.attackMode,
		isCritical: options.isCritical,
		isConcentration: options.isConcentration,
		isDeathSave: options.isDeathSave,
		isInitiative: options.isInitiative,
		damageTypes: options.damageTypes,
		defaultDamageType: options.defaultDamageType,
	};
	try {
		return JSON.stringify(profile);
	} catch {
		return String(profile?.ability ?? '');
	}
}

function createChecksSnapshot(ac5eConfig) {
	return {
		subject: cloneCheckSide(ac5eConfig.subject),
		opponent: cloneCheckSide(ac5eConfig.opponent),
		parts: foundry.utils.duplicate(ac5eConfig.parts ?? []),
		targetADC: foundry.utils.duplicate(ac5eConfig.targetADC ?? []),
		extraDice: foundry.utils.duplicate(ac5eConfig.extraDice ?? []),
		diceUpgrade: foundry.utils.duplicate(ac5eConfig.diceUpgrade ?? []),
		diceDowngrade: foundry.utils.duplicate(ac5eConfig.diceDowngrade ?? []),
		threshold: foundry.utils.duplicate(ac5eConfig.threshold ?? []),
		fumbleThreshold: foundry.utils.duplicate(ac5eConfig.fumbleThreshold ?? []),
		damageModifiers: foundry.utils.duplicate(ac5eConfig.damageModifiers ?? []),
		modifiers: foundry.utils.duplicate(ac5eConfig.modifiers ?? {}),
		pendingUses: foundry.utils.duplicate(ac5eConfig.pendingUses ?? []),
	};
}

function applyChecksSnapshot(ac5eConfig, snapshot) {
	if (!snapshot) return;
	ac5eConfig.subject = cloneCheckSide(snapshot.subject ?? {});
	ac5eConfig.opponent = cloneCheckSide(snapshot.opponent ?? {});
	ac5eConfig.parts = foundry.utils.duplicate(snapshot.parts ?? []);
	ac5eConfig.targetADC = foundry.utils.duplicate(snapshot.targetADC ?? []);
	ac5eConfig.extraDice = foundry.utils.duplicate(snapshot.extraDice ?? []);
	ac5eConfig.diceUpgrade = foundry.utils.duplicate(snapshot.diceUpgrade ?? []);
	ac5eConfig.diceDowngrade = foundry.utils.duplicate(snapshot.diceDowngrade ?? []);
	ac5eConfig.threshold = foundry.utils.duplicate(snapshot.threshold ?? []);
	ac5eConfig.fumbleThreshold = foundry.utils.duplicate(snapshot.fumbleThreshold ?? []);
	ac5eConfig.damageModifiers = foundry.utils.duplicate(snapshot.damageModifiers ?? []);
	ac5eConfig.modifiers = foundry.utils.duplicate(snapshot.modifiers ?? {});
	ac5eConfig.pendingUses = foundry.utils.duplicate(snapshot.pendingUses ?? []);
}

function cloneCheckSide(side = {}) {
	const clone = {};
	for (const [key, value] of Object.entries(side ?? {})) {
		if (value instanceof Set) clone[key] = new Set(value);
		else if (Array.isArray(value)) clone[key] = foundry.utils.duplicate(value);
		else if (value && typeof value === 'object') clone[key] = foundry.utils.duplicate(value);
		else clone[key] = value;
	}
	return clone;
}

function buildStatusEffectsContext({ ac5eConfig, subjectToken, opponentToken, exhaustionLvl, type } = {}) {
	const { ability, activity, attackMode, distance, hook, isConcentration, isDeathSave, isInitiative } = ac5eConfig.options;
	const distanceUnit = canvas.grid.distance;
	const subject = subjectToken?.actor;
	const opponent = opponentToken?.actor;
	const modernRules = settings.dnd5eModernRules;
	const item = activity?.item;
	if (activity && !_activeModule('midi-qol')) activity.hasDamage = !foundry.utils.isEmpty(activity?.damage?.parts); //Cannot set property hasDamage of #<MidiActivityMixin> which has only a getter
	const subjectMove = Object.values(subject?.system.attributes.movement || {}).some((v) => typeof v === 'number' && v);
	const opponentMove = Object.values(opponent?.system.attributes.movement || {}).some((v) => typeof v === 'number' && v);
	const subjectAlert2014 = !modernRules && subject?.items.some((item) => item.name.includes(_localize('AC5E.Alert')));
	const opponentAlert2014 = !modernRules && opponent?.items.some((item) => item.name.includes(_localize('AC5E.Alert')));

	return {
		ability,
		activity,
		attackMode,
		distance,
		distanceUnit,
		exhaustionLvl,
		hook,
		isConcentration,
		isDeathSave,
		isInitiative,
		item,
		modernRules,
		opponent,
		opponentAlert2014,
		opponentMove,
		opponentToken,
		subject,
		subjectAlert2014,
		subjectMove,
		subjectToken,
		type,
	};
}

function buildStatusEffectsTables() {
	const mkStatus = (id, name, rules) => ({ _id: _staticID(id), name, rules });

	const tables = {
		blinded: mkStatus('blinded', _i18nConditions('Blinded'), {
			attack: {
				subject: (ctx) => (!_canSee(ctx.subjectToken, ctx.opponentToken) ? 'disadvantage' : ''),
				opponent: (ctx) => (!_canSee(ctx.opponentToken, ctx.subjectToken) && !ctx.subjectAlert2014 ? 'advantage' : ''),
			},
		}),

		charmed: mkStatus('charmed', _i18nConditions('Charmed'), {
			check: { subject: (ctx) => (hasStatusFromOpponent(ctx.subject, 'charmed', ctx.opponent) ? 'advantage' : '') },
			use: { subject: (ctx) => (hasStatusFromOpponent(ctx.subject, 'charmed', ctx.opponent) ? 'fail' : '') },
		}),

		deafened: mkStatus('deafened', _i18nConditions('Deafened'), {}),

		exhaustion: mkStatus('exhaustion', _i18nConditions('Exhaustion'), {
			levels: {
				1: { check: { subject: () => 'disadvantageNames' } },
				3: {
					check: { subject: () => 'disadvantageNames' },
					save: { subject: () => 'disadvantageNames' },
					attack: { subject: () => 'disadvantage' },
				},
			},
		}),

		frightened: mkStatus('frightened', _i18nConditions('Frightened'), {
			attack: { subject: (ctx) => (isFrightenedByVisibleSource(ctx) ? 'disadvantage' : '') },
			check: { subject: (ctx) => (isFrightenedByVisibleSource(ctx) ? 'disadvantage' : '') },
		}),

		incapacitated: mkStatus('incapacitated', _i18nConditions('Incapacitated'), {
			use: { subject: (ctx) => (['action', 'bonus', 'reaction'].includes(ctx.activity?.activation?.type) ? 'fail' : '') },
			check: { subject: (ctx) => (ctx.modernRules && ctx.isInitiative ? 'disadvantage' : '') },
		}),

		invisible: mkStatus('invisible', _i18nConditions('Invisible'), {
			attack: {
				subject: (ctx) => (!ctx.opponentAlert2014 && !_canSee(ctx.opponentToken, ctx.subjectToken) ? 'advantage' : ''),
				opponent: (ctx) => (!_canSee(ctx.subjectToken, ctx.opponentToken) ? 'disadvantage' : ''),
			},
			check: { subject: (ctx) => (ctx.modernRules && ctx.isInitiative ? 'advantage' : '') },
		}),

		paralyzed: mkStatus('paralyzed', _i18nConditions('Paralyzed'), {
			save: { subject: (ctx) => (['str', 'dex'].includes(ctx.ability) ? 'fail' : '') },
			attack: { opponent: () => 'advantage' },
			damage: { opponent: (ctx) => (ctx.activity?.hasDamage && ctx.distance <= ctx.distanceUnit ? 'critical' : '') },
		}),

		petrified: mkStatus('petrified', _i18nConditions('Petrified'), {
			save: { subject: (ctx) => (['str', 'dex'].includes(ctx.ability) ? 'fail' : '') },
			attack: { opponent: () => 'advantage' },
		}),

		poisoned: mkStatus('poisoned', _i18nConditions('Poisoned'), {
			attack: { subject: () => 'disadvantage' },
			check: { subject: () => 'disadvantageNames' },
		}),

		prone: mkStatus('prone', _i18nConditions('Prone'), {
			attack: {
				subject: () => 'disadvantage',
				opponent: (ctx) => (ctx.distance <= ctx.distanceUnit ? 'advantage' : 'disadvantage'),
			},
		}),

		restrained: mkStatus('restrained', _i18nConditions('Restrained'), {
			attack: { subject: () => 'disadvantage', opponent: () => 'advantage' },
			save: { subject: (ctx) => (ctx.ability === 'dex' ? 'disadvantageNames' : '') },
		}),

		silenced: mkStatus('silenced', _i18nConditions('Silenced'), {
			use: { subject: (ctx) => (ctx.item?.system.properties.has('vocal') ? 'fail' : '') },
		}),

		stunned: mkStatus('stunned', _i18nConditions('Stunned'), {
			attack: { opponent: () => 'advantage' },
			save: { subject: (ctx) => (['dex', 'str'].includes(ctx.ability) ? 'fail' : '') },
		}),

		unconscious: mkStatus('unconscious', _i18nConditions('Unconscious'), {
			attack: { opponent: () => 'advantage' },
			damage: { opponent: (ctx) => (ctx.activity?.hasDamage && ctx.distance <= ctx.distanceUnit ? 'critical' : '') },
			save: { subject: (ctx) => (['dex', 'str'].includes(ctx.ability) ? 'fail' : '') },
		}),

		surprised: mkStatus('surprised', _i18nConditions('Surprised'), {
			check: { subject: (ctx) => (ctx.modernRules && ctx.isInitiative ? 'disadvantage' : '') },
		}),

		grappled: mkStatus('grappled', _i18nConditions('Grappled'), {
			attack: {
				subject: (ctx) => (ctx.modernRules && hasGrappledFromOther(ctx) ? 'disadvantage' : ''),
			},
		}),

		dodging: mkStatus('dodging', _i18nConditions('Dodging'), {
			attack: {
				opponent: (ctx) =>
					(settings.expandedConditions && ctx.opponentToken && ctx.subject && _canSee(ctx.opponentToken, ctx.subjectToken) && !ctx.opponent?.statuses.has('incapacitated') && ctx.opponentMove ? 'disadvantage' : ''),
			},
			save: {
				subject: (ctx) => (settings.expandedConditions && ctx.ability === 'dex' && ctx.subject && !ctx.subject?.statuses.has('incapacitated') && ctx.subjectMove ? 'advantage' : ''),
			},
		}),

		hiding: mkStatus('hiding', _i18nConditions('Hiding'), {
			attack: { subject: (ctx) => (!settings.expandedConditions ? '' : !ctx.opponentAlert2014 ? 'advantage' : ''), opponent: () => (!settings.expandedConditions ? '' : 'disadvantage') },
			check: { subject: (ctx) => (settings.expandedConditions && ctx.modernRules && ctx.isInitiative ? 'advantage' : '') },
		}),

		raging: mkStatus('raging', _localize('AC5E.Raging'), {
			save: {
				subject: (ctx) => (settings.expandedConditions && ctx.ability === 'str' && ctx.subject?.armor?.system.type.value !== 'heavy' ? 'advantage' : ''),
			},
			check: {
				subject: (ctx) => (settings.expandedConditions && ctx.ability === 'str' && ctx.subject?.armor?.system.type.value !== 'heavy' ? 'advantage' : ''),
			},
			use: { subject: (ctx) => (settings.expandedConditions && ctx.item?.type === 'spell' ? 'fail' : '') },
		}),

		underwaterCombat: mkStatus('underwater', _localize('AC5E.UnderwaterCombat'), {
			attack: {
				subject: (ctx) => {
					if (!settings.expandedConditions) return '';
					const isMelee =
						ctx.activity?.getActionType(ctx.attackMode) === 'mwak' &&
						!ctx.subject?.system.attributes.movement.swim &&
						!['dagger', 'javelin', 'shortsword', 'spear', 'trident'].includes(ctx.item?.system.type.baseItem);
					const isRanged =
						ctx.activity?.getActionType(ctx.attackMode) === 'rwak' &&
						!['lightcrossbow', 'handcrossbow', 'heavycrossbow', 'net'].includes(ctx.item?.system.type.baseItem) &&
						!ctx.item?.system.properties.has('thr') &&
						ctx.distance <= ctx.activity?.range.value;
					if (isMelee || isRanged) return 'disadvantage';
					if (ctx.activity?.getActionType(ctx.attackMode) === 'rwak' && ctx.distance > ctx.activity?.range.value) return 'fail';
					return '';
				},
			},
		}),
	};

	return tables;
}

function hasStatusFromOpponent(actor, status, origin) {
	return actor?.appliedEffects.some((effect) => effect.statuses.has(status) && effect.origin && _getEffectOriginToken(effect, 'token')?.actor.uuid === origin?.uuid);
}

function hasGrappledFromOther(ctx) {
	return ctx.subject?.appliedEffects.some((e) => e.statuses.has('grappled') && e.origin && _getEffectOriginToken(e, 'token') !== ctx.opponentToken);
}

function isFrightenedByVisibleSource(ctx) {
	if (ctx.type !== 'subject') return false;
	const frightenedEffects = ctx.subject?.appliedEffects.filter((effect) => effect.statuses.has('frightened') && effect.origin);
	if (ctx.subject?.statuses.has('frightened') && !frightenedEffects.length) return true; //if none of the effects that apply frightened status on the actor have an origin, force true
	return frightenedEffects.some((effect) => {
		const originToken = _getEffectOriginToken(effect, 'token'); //undefined if no effect.origin
		return originToken && _canSee(ctx.subjectToken, originToken);
	});
}

function getStatusEffectResult({ status, statusEntry, hook, type, context, exhaustionLvl, isSubjectExhausted }) {
	if (!statusEntry) return '';
	if (status === 'exhaustion' && isSubjectExhausted) {
		const levelRules = statusEntry.rules?.levels?.[exhaustionLvl];
		const result = evaluateStatusRule(levelRules?.[hook]?.[type], context);
		return applyStatusEffectOverrides({ status, hook, type, context, result });
	}
	const result = evaluateStatusRule(statusEntry.rules?.[hook]?.[type], context);
	return applyStatusEffectOverrides({ status, hook, type, context, result });
}

function evaluateStatusRule(rule, context) {
	if (!rule) return '';
	return typeof rule === 'function' ? rule(context) : rule;
}

function applyStatusEffectOverrides({ status, hook, type, context, result }) {
	if (!statusEffectsOverrideState.list.length) return result;
	const matches = statusEffectsOverrideState.list
		.filter((entry) => matchesStatusEffectOverride(entry, status, hook, type))
		.sort((a, b) => (a.priority || 0) - (b.priority || 0));
	if (!matches.length) return result;
	let nextResult = result;
	for (const entry of matches) {
		if (typeof entry.when === 'function') {
			if (!entry.when({ status, hook, type, context, result: nextResult })) continue;
		} else if (entry.when === false) {
			continue;
		}
		if (typeof entry.apply === 'function') {
			const updated = entry.apply({ status, hook, type, context, result: nextResult });
			if (updated !== undefined) nextResult = updated;
			continue;
		}
		if (entry.result !== undefined) nextResult = entry.result;
	}
	return nextResult;
}

function matchesStatusEffectOverride(entry, status, hook, type) {
	const statusMatch = matchesOverrideField(entry.status, status);
	const hookMatch = matchesOverrideField(entry.hook, hook);
	const typeMatch = matchesOverrideField(entry.type, type);
	return statusMatch && hookMatch && typeMatch;
}

function matchesOverrideField(field, value) {
	if (!field || field === '*' || field === 'all') return true;
	if (Array.isArray(field)) return field.includes(value);
	return field === value;
}

function shouldIgnoreStatus(actor, statusId) {
	const flagName = `no${statusId.capitalize()}`;
	return Boolean(foundry.utils.getProperty(actor, `flags.ac5e.${flagName}`));
}

function automatedItemsTables({ ac5eConfig, subjectToken, opponentToken }) {
	const automatedItems = {};
	const { activity } = ac5eConfig.options;
	automatedItems[_localize('AC5E.Items.DwarvenResilience')] = {
		name: _localize('AC5E.Items.DwarvenResilience'),
		save: { subject: _getActivityEffectsStatusRiders(activity)['poisoned'] ? 'advantage' : '' },
	};
	return automatedItems;
}

// function ac5eAutoSettingsTables({ ac5eConfig, subjectToken, opponent, opponentToken, ac5eConfig, hook, ability, distance, activity, tool, skill, options }) {
// 	const ac5eAutoSettings = {};
// 	if (settings.autoRanged && ['rwak', 'rsak'].includes(item.system.actionType)) {
// 		const { nearbyFoe } = _autoRanged(item, subjectToken);
// 		if (nearbyFoe) {
// 			ac5eAutoSettings.nearbyFoe = {
// 				name: _localize('AC5E.NearbyFoe'),
// 				attack: { subject: 'disadvantage' },
// 			};
// 		}
// 	}
// }

function ac5eFlags({ ac5eConfig, subjectToken, opponentToken }) {
	const options = ac5eConfig.options;
	const { ability, activity, distance, hook, skill, tool, isConcentration, isDeathSave, isInitiative } = options;
	const subject = subjectToken?.actor;
	const opponent = opponentToken?.actor;
	const item = activity?.item;

	//flags.ac5e.<actionType>.<mode>
	// actionType = all/attack/damage/check/conc/death/init/save/skill/tool
	// in options there are options.isDeathSave options.isInitiative options.isConcentration

	if (settings.debug) console.error('AC5E._ac5eFlags:', { subject, subjectToken, opponent, opponentToken, ac5eConfig, hook, ability, distance, activity, tool, skill, options });

	const distanceToSource = (token, wallsBlock) => _getDistance(token, subjectToken, false, true, wallsBlock, true);
	const distanceToTarget = (token, wallsBlock) => _getDistance(token, opponentToken, false, true, wallsBlock, true);

	const evaluationData = _createEvaluationSandbox({ subjectToken, opponentToken, options });

	const getActorAndModeType = (el, includeAuras = false) => {
		const key = el.key?.toLowerCase() ?? '';
		const isAll = key.includes('all');

		const actorType = key.includes('grants') ? 'opponent' : (includeAuras && key.includes('aura')) || (!key.includes('aura') && !key.includes('grants')) ? 'subject' : undefined;

		const modeMap = [
			['noadv', 'noAdvantage'],
			['nocrit', 'noCritical'],
			['nodis', 'noDisadvantage'],
			['diceupgrade', 'diceUpgrade'],
			['dicedowngrade', 'diceDowngrade'],
			['dis', 'disadvantage'],
			['adv', 'advantage'],
			['criticalthres', 'criticalThreshold'],
			['fumblethres', 'fumbleThreshold'],
			['crit', 'critical'],
			['modifyac', 'targetADC'], //we cleared the conflict with "mod" mode by going first
			['modifydc', 'targetADC'],
			['mod', 'modifiers'],
			['bonus', 'bonus'],
			['fail', 'fail'],
			['fumble', 'fumble'],
			['success', 'success'],
			['extradice', 'extraDice'],
			['range', 'range'],
		];

		const mode = modeMap.find(([m]) => key.includes(m))?.[1];
		return { actorType, mode, isAll };
	};

	const validFlags = [];
	const pushUniqueValidFlag = (entry) => {
		if (!entry?.id) {
			validFlags.push(entry);
			return;
		}
		if (validFlags.some((existing) => existing?.id === entry.id)) {
			if (ac5e?.debugOptins) console.warn('AC5E optins: duplicate entry id skipped', { id: entry.id, entry });
			return;
		}
		validFlags.push(entry);
	};

	//Will return false only in case of both tokens being available AND the value includes allies OR enemies and the test of dispositionCheck returns false;
	const friendOrFoe = (tokenA, tokenB, value) => {
		if (!tokenA || !tokenB) return true;
		const alliesOrEnemies = value.includes('allies') ? 'allies' : value.includes('enemies') ? 'enemies' : null;
		if (!alliesOrEnemies) return true;
		return alliesOrEnemies === 'allies' ? _dispositionCheck(tokenA, tokenB, 'same') : !_dispositionCheck(tokenA, tokenB, 'same');
	};
	const effectChangesTest = ({ change, actorType, hook, effect, updateArrays, auraTokenEvaluationData, evaluationData, changeIndex, auraTokenUuid }) => {
		const evalData = auraTokenEvaluationData ?? evaluationData ?? {};
		const debug = { effectUuid: effect.uuid, changeKey: change.key };
		const isAC5eFlag = ['ac5e', 'automated-conditions-5e'].some((scope) => change.key.includes(scope));
		if (!isAC5eFlag) return false;
		const isAll = change.key.includes('all');
		const isSkill = skill && change.key.includes('skill');
		const isTool = tool && change.key.includes('tool');
		const isConc = isConcentration && hook === 'save' && change.key.includes('conc');
		const isInit = isInitiative && hook === 'check' && change.key.includes('init');
		const isDeath = isDeathSave && hook === 'save' && change.key.includes('death');
		const isModifyAC = change.key.includes('modifyAC') && hook === 'attack';
		const isModifyDC = change.key.includes('modifyDC') && (hook === 'check' || hook === 'save' || isSkill || isTool);
		const modifyHooks = isModifyAC || isModifyDC;
		const isRange = change.key.toLowerCase().includes('.range');
		const hasHook = change.key.includes(hook) || isAll || isConc || isDeath || isInit || isSkill || isTool || modifyHooks || (isRange && hook === 'attack');
		if (!hasHook) return false;
		const shouldProceedUses = handleUses({ actorType, change, effect, evalData, updateArrays, debug, hook, changeIndex, auraTokenUuid });
		if (!shouldProceedUses) return false;
		if (change.value.toLowerCase().includes('itemlimited') && !effect.origin?.includes(evalData.item?.id)) return false;
		if (change.key.includes('aura') && auraTokenEvaluationData) {
			//isAura
			const auraToken = canvas.tokens.get(auraTokenEvaluationData.auraTokenId);
			if (auraTokenEvaluationData.auraTokenId === (isModifyAC ? opponentToken.id : subjectToken.id)) return change.value.toLowerCase().includes('includeself');
			if (!friendOrFoe(auraToken, isModifyAC ? opponentToken : subjectToken, change.value)) return false;
			let radius = getBlacklistedKeysValue('radius', change.value);
			if (!radius) return true; //if no radius set, always apply to the whole map
			radius = bonusReplacements(radius, auraTokenEvaluationData, true, effect);
			if (!radius) return false;
			if (radius) radius = _ac5eSafeEval({ expression: radius, sandbox: auraTokenEvaluationData, mode: 'formula', debug });
			if (!radius) return false;
			const distanceTokenToAuraSource = !isModifyAC ? distanceToSource(auraToken, change.value.toLowerCase().includes('wallsblock') && 'sight') : distanceToTarget(auraToken, change.value.toLowerCase().includes('wallsblock') && 'sight');
			if (distanceTokenToAuraSource <= radius) auraTokenEvaluationData.distanceTokenToAuraSource = distanceTokenToAuraSource;
			else return false;
		} else if (change.key.includes('grants')) {
			//isGrants
			if (actorType === 'aura') return false;
			else if (actorType === 'subject' && !(isModifyAC || isModifyDC)) return false;
			else if (actorType === 'opponent' && isModifyDC) return false;
			if (!friendOrFoe(opponentToken, subjectToken, change.value)) return false;
		} else {
			//isSelf
			if (actorType === 'aura') return false;
			else if (actorType === 'opponent' && !(isModifyAC || isModifyDC)) return false;
			else if (actorType === 'subject' && isModifyAC) return false;
			if (!friendOrFoe(opponentToken, subjectToken, change.value)) return false;
		}
		return true;
	};

	const blacklist = new Set(['addto', 'allies', 'bonus', 'description', 'enemies', 'includeself', 'itemlimited', 'long', 'modifier', 'name', 'noconc', 'noconcentration', 'noconcentrationcheck', 'nolongdisadvantage', 'once', 'optin', 'radius', 'reach', 'set', 'short', 'singleaura', 'threshold', 'usescount', 'wallsblock']);
	const damageTypeKeys = Object.keys(CONFIG?.DND5E?.damageTypes ?? {}).map((k) => k.toLowerCase());
	const damageTypeSet = new Set(damageTypeKeys);
	const getRequiredDamageTypes = (value) => {
		if (!value) return [];
		return value
			.split(';')
			.map((v) => v.trim().toLowerCase())
			.filter((v) => v && !v.includes('=') && !v.includes(':') && !blacklist.has(v) && damageTypeSet.has(v));
	};
	const getCustomName = (value) => {
		if (!value) return undefined;
		const match = value.match(/(?:^|;)\s*name\s*[:=]\s*([^;]+)/i);
		const name = match?.[1]?.trim();
		return name || undefined;
	};
	const getAddTo = (value) => {
		if (!value) return undefined;
		const match = value.match(/(?:^|;)\s*addto\s*[:=]\s*([^;]+)/i);
		const raw = match?.[1]?.trim()?.toLowerCase();
		if (!raw) return undefined;
		if (raw === 'all') return { mode: 'all', types: [] };
		const types = raw.split(/[,|]/).map((v) => v.trim()).filter(Boolean);
		return types.length ? { mode: 'types', types } : undefined;
	};
	const getDescription = (value) => {
		if (!value) return undefined;
		const match = value.match(/(?:^|;)\s*description\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i);
		const raw = match?.[1] ?? match?.[2] ?? match?.[3];
		const description = raw?.trim();
		return description || undefined;
	};
	const localizeText = (key, fallback) => {
		const localized = _localize(key);
		return localized === key ? fallback : localized;
	};
	const localizeTemplate = (key, data, fallback) => {
		if (game?.i18n?.has?.(key)) return game.i18n.format(key, data ?? {});
		return fallback;
	};
	const hookLabel = (hookType) => {
		if (hookType === 'attack') return localizeText('AC5E.OptinDescription.Roll.Attack', 'attack rolls');
		if (hookType === 'damage') return localizeText('AC5E.OptinDescription.Roll.Damage', 'damage rolls');
		if (hookType === 'check') return localizeText('AC5E.OptinDescription.Roll.Check', 'checks');
		if (hookType === 'save') return localizeText('AC5E.OptinDescription.Roll.Save', 'saving throws');
		return localizeText('AC5E.OptinDescription.Roll.Generic', 'rolls');
	};
	const formatSignedNumber = (value) => {
		const num = Number(value);
		if (Number.isFinite(num)) return num >= 0 ? `+${num}` : `${num}`;
		return String(value ?? '').trim();
	};
	const buildAutoDescription = ({ mode, hook, bonus, modifier, set, threshold }) => {
		const roll = hookLabel(hook);
		switch (mode) {
			case 'advantage':
				return localizeTemplate('AC5E.OptinDescription.GrantsAdvantage', { roll }, `Grants advantage on ${roll}`);
			case 'disadvantage':
				return localizeTemplate('AC5E.OptinDescription.ImposesDisadvantage', { roll }, `Imposes disadvantage on ${roll}`);
			case 'noAdvantage':
				return localizeTemplate('AC5E.OptinDescription.RemovesAdvantage', { roll }, `Removes advantage on ${roll}`);
			case 'noDisadvantage':
				return localizeTemplate('AC5E.OptinDescription.RemovesDisadvantage', { roll }, `Removes disadvantage on ${roll}`);
			case 'critical':
				return localizeText('AC5E.OptinDescription.ForcesCritical', 'Forces a critical hit');
			case 'noCritical':
				return localizeText('AC5E.OptinDescription.PreventsCritical', 'Prevents critical hits');
			case 'fail':
				return localizeTemplate('AC5E.OptinDescription.ForcesFailure', { roll }, `Forces automatic failure on ${roll}`);
			case 'fumble':
				return localizeText('AC5E.OptinDescription.ForcesFumble', 'Forces a fumble');
			case 'success':
				return localizeTemplate('AC5E.OptinDescription.ForcesSuccess', { roll }, `Forces automatic success on ${roll}`);
			case 'bonus':
				if (set !== undefined) return localizeTemplate('AC5E.OptinDescription.SetsRollBonus', { roll, value: set }, `Sets ${roll} bonus to ${set}`);
				if (bonus !== undefined && bonus !== '') return localizeTemplate('AC5E.OptinDescription.AppliesRollBonus', { roll, value: formatSignedNumber(bonus) }, `Applies ${formatSignedNumber(bonus)} to ${roll}`);
				return localizeTemplate('AC5E.OptinDescription.ModifiesRollBonus', { roll }, `Modifies ${roll} bonus`);
			case 'targetADC':
				if (set !== undefined) return localizeTemplate('AC5E.OptinDescription.SetsTargetAC', { value: set }, `Sets target AC to ${set}`);
				if (bonus !== undefined && bonus !== '') return localizeTemplate('AC5E.OptinDescription.ModifiesTargetACBy', { value: formatSignedNumber(bonus) }, `Modifies target AC by ${formatSignedNumber(bonus)}`);
				return localizeText('AC5E.OptinDescription.ModifiesTargetAC', 'Modifies target AC');
			case 'modifiers':
				if (typeof modifier === 'string') {
					const minMatch = modifier.match(/^min\s*(-?\d+(?:\.\d+)?)$/i);
					if (minMatch) return localizeTemplate('AC5E.OptinDescription.SetsMinimumD20', { value: minMatch[1] }, `Sets minimum d20 result to ${minMatch[1]}`);
					const maxMatch = modifier.match(/^max\s*(-?\d+(?:\.\d+)?)$/i);
					if (maxMatch) return localizeTemplate('AC5E.OptinDescription.SetsMaximumD20', { value: maxMatch[1] }, `Sets maximum d20 result to ${maxMatch[1]}`);
					return localizeTemplate('AC5E.OptinDescription.AppliesRollModifierWithValue', { value: modifier }, `Applies roll modifier (${modifier})`);
				}
				return localizeText('AC5E.OptinDescription.AppliesRollModifier', 'Applies roll modifier');
			case 'criticalThreshold':
				if (threshold !== undefined) return localizeTemplate('AC5E.OptinDescription.SetsCriticalThreshold', { value: threshold }, `Sets critical threshold to ${threshold}`);
				if (set !== undefined) return localizeTemplate('AC5E.OptinDescription.SetsCriticalThreshold', { value: set }, `Sets critical threshold to ${set}`);
				return localizeText('AC5E.OptinDescription.ModifiesCriticalThreshold', 'Modifies critical threshold');
			case 'fumbleThreshold':
				if (threshold !== undefined) return localizeTemplate('AC5E.OptinDescription.SetsFumbleThreshold', { value: threshold }, `Sets fumble threshold to ${threshold}`);
				if (set !== undefined) return localizeTemplate('AC5E.OptinDescription.SetsFumbleThreshold', { value: set }, `Sets fumble threshold to ${set}`);
				return localizeText('AC5E.OptinDescription.ModifiesFumbleThreshold', 'Modifies fumble threshold');
			case 'extraDice':
				if (bonus !== undefined && bonus !== '') return localizeTemplate('AC5E.OptinDescription.AddsExtraDamageDiceWithValue', { value: bonus }, `Adds extra damage dice (${bonus})`);
				return localizeText('AC5E.OptinDescription.AddsExtraDamageDice', 'Adds extra damage dice');
			case 'diceUpgrade':
				if (bonus !== undefined && bonus !== '') return localizeTemplate('AC5E.OptinDescription.UpgradesDamageDiceWithValue', { value: bonus }, `Upgrades damage dice (${bonus})`);
				return localizeText('AC5E.OptinDescription.UpgradesDamageDice', 'Upgrades damage dice');
			case 'diceDowngrade':
				if (bonus !== undefined && bonus !== '') return localizeTemplate('AC5E.OptinDescription.DowngradesDamageDiceWithValue', { value: bonus }, `Downgrades damage dice (${bonus})`);
				return localizeText('AC5E.OptinDescription.DowngradesDamageDice', 'Downgrades damage dice');
			case 'range':
				return localizeText('AC5E.OptinDescription.ModifiesAttackRange', 'Modifies attack range behavior');
			default:
				return undefined;
		}
	};
	const parseBooleanValue = (raw) => {
		if (raw === undefined || raw === null) return undefined;
		const normalized = String(raw).trim().toLowerCase();
		if (!normalized.length) return true;
		if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
		if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
		return undefined;
	};
	const parseRangeComponent = ({ expression, evaluationData, effect, isAura, debug }) => {
		if (expression === undefined || expression === null) return undefined;
		const raw = String(expression).trim();
		if (!raw.length) return undefined;
		const operation = /^[+-]/.test(raw) ? 'delta' : 'set';
		const replacement = bonusReplacements(raw, evaluationData, isAura, effect);
		let evaluated = _ac5eSafeEval({ expression: replacement, sandbox: evaluationData, mode: 'formula', debug });
		if (!Number.isFinite(Number(evaluated))) evaluated = evalDiceExpression(evaluated);
		const value = Number(evaluated);
		if (!Number.isFinite(value)) return undefined;
		return { operation, value };
	};
	const parseRangeData = ({ key, value, evaluationData, effect, isAura, debug }) => {
		const lowerKey = String(key ?? '').toLowerCase();
		const explicitMatch = lowerKey.match(/\.range\.(short|long|reach|nolongdisadvantage)$/i);
		const explicitValue = String(value ?? '')
			.split(';')
			.map((v) => v.trim())
			.find((v) => v && !v.includes('=') && !v.includes(':')) ?? String(value ?? '').split(';')[0]?.trim() ?? '';
		const rangeData = {};
		const shortRaw = explicitMatch?.[1] === 'short' ? explicitValue : getBlacklistedKeysValue('short', value);
		const longRaw = explicitMatch?.[1] === 'long' ? explicitValue : getBlacklistedKeysValue('long', value);
		const reachRaw = explicitMatch?.[1] === 'reach' ? explicitValue : getBlacklistedKeysValue('reach', value);
		const bonusRaw = getBlacklistedKeysValue('bonus', value);
		const noLongRaw = explicitMatch?.[1] === 'nolongdisadvantage' ? explicitValue : getBlacklistedKeysValue('noLongDisadvantage', value);
		if (shortRaw) rangeData.short = parseRangeComponent({ expression: shortRaw, evaluationData, effect, isAura, debug });
		if (longRaw) rangeData.long = parseRangeComponent({ expression: longRaw, evaluationData, effect, isAura, debug });
		if (reachRaw) rangeData.reach = parseRangeComponent({ expression: reachRaw, evaluationData, effect, isAura, debug });
		if (bonusRaw) rangeData.bonus = parseRangeComponent({ expression: bonusRaw, evaluationData, effect, isAura, debug });
		let noLongDisadvantage = parseBooleanValue(noLongRaw);
		if (noLongDisadvantage === undefined && /(?:^|;)\s*nolongdisadvantage\s*(?:;|$)/i.test(value ?? '')) noLongDisadvantage = true;
		if (typeof noLongDisadvantage === 'boolean') rangeData.noLongDisadvantage = noLongDisadvantage;
		return rangeData;
	};
	const buildEntryLabel = (baseLabel, customName) => {
		if (customName) return `${baseLabel} (${customName})`;
		return baseLabel;
	};
	const applyIndexLabels = (entry, existing) => {
		if (entry.customName) return;
		const sameUnnamed = existing.filter((e) => !e.customName);
		if (!sameUnnamed.length) return;
		const updateIndexLabel = (target) => {
			if (target.customName) return;
			if (target.label?.includes('#')) return;
			const indexValue = Number.isInteger(target.changeIndex) ? target.changeIndex : undefined;
			if (indexValue === undefined) return;
			target.label = `${target.label} #${indexValue}`;
			target.index = indexValue;
		};
		sameUnnamed.forEach((e) => updateIndexLabel(e));
		updateIndexLabel(entry);
	};

	const updateArrays = {
		activityUpdates: [],
		activityUpdatesGM: [],
		actorUpdates: [],
		actorUpdatesGM: [],
		effectDeletions: [],
		effectDeletionsGM: [],
		effectUpdates: [],
		effectUpdatesGM: [],
		itemUpdates: [],
		itemUpdatesGM: [],
		pendingUses: [],
	};
	// const placeablesWithRelevantAuras = {};
	canvas.tokens.placeables.filter((token) => {
		if (!token.actor) return false;
		// if (token.actor.items.getName(_localize('AC5E.Items.AuraOfProtection'))) {
		// }
		//const distanceTokenToAuraSource = distanceToSource(token, false);
		const currentCombatant = game.combat?.active ? game.combat.combatant?.tokenId : null;
		const auraTokenEvaluationData = foundry.utils.mergeObject(evaluationData, { auraActor: _ac5eActorRollData(token), isAuraSourceTurn: currentCombatant === token?.id, auraTokenId: token.id }, { inplace: false });
		auraTokenEvaluationData.effectActor = auraTokenEvaluationData.auraActor;
		token.actor.appliedEffects.filter((effect) =>
			effect.changes.forEach((el, changeIndex) => {
				if (!effectChangesTest({ change: el, actorType: 'aura', hook, effect, updateArrays, auraTokenEvaluationData, changeIndex, auraTokenUuid: token?.document?.uuid })) return;
				const { actorType, mode } = getActorAndModeType(el, true);
				if (!actorType || !mode) return;
				const debug = { effectUuid: effect.uuid, changeKey: el.key };
				const { bonus, modifier, set, threshold } = preEvaluateExpression({ value: el.value, mode, hook, effect, evaluationData: auraTokenEvaluationData, isAura: true, debug });
				const wallsBlock = el.value.toLowerCase().includes('wallsblock') && 'sight';
				const auraOnlyOne = el.value.toLowerCase().includes('singleaura');
				const optin = el.value.toLowerCase().includes('optin');
				const customName = getCustomName(el.value);
				const requiredDamageTypes = getRequiredDamageTypes(el.value);
				const addTo = getAddTo(el.value);
				const description = getDescription(el.value);
				const autoDescription = !description && optin ? buildAutoDescription({ mode, hook, bonus, modifier, set, threshold }) : undefined;
				let valuesToEvaluate = el.value
					.split(';')
					.map((v) => v.trim())
					.filter((v) => {
						if (!v) return false;
						const [key] = v.split(/[:=]/).map((s) => s.trim());
						return !blacklist.has(key.toLowerCase());
					})
					.join(';');
				if (!valuesToEvaluate) valuesToEvaluate = mode === 'bonus' && !bonus ? 'false' : 'true';
				if (valuesToEvaluate.includes('effectOriginTokenId')) valuesToEvaluate = valuesToEvaluate.replaceAll('effectOriginTokenId', `"${_getEffectOriginToken(effect, 'id')}"`);

				const evaluation = getMode({ value: valuesToEvaluate, auraTokenEvaluationData, debug });
				if (!evaluation) return;

				if (auraOnlyOne) {
					const sameAuras = validFlags.filter((entry) => entry.isAura && entry.name === effect.name);
					if (sameAuras.length) {
						let shouldAdd = true;
						for (const aura of sameAuras) {
							const auraBonus = aura.bonus;
							const replaceAura = (!isNaN(auraBonus) && !isNaN(bonus) && auraBonus < bonus) || ((!isNaN(auraBonus) || !isNaN(bonus)) && aura.distance > _getDistance(token, subjectToken, false, true, wallsBlock));
							if (replaceAura) {
								const idx = validFlags.indexOf(aura);
								if (idx >= 0) validFlags.splice(idx, 1);
							} else {
								shouldAdd = false;
								break;
							}
						}
						if (!shouldAdd) return true;
					}
				}
				const entryId = `${effect.uuid ?? effect.id}:${changeIndex}:${hook}:aura:${token.document.uuid}`;
				const labelBase = `${effect.name} - Aura (${token.name})`;
				const label = buildEntryLabel(labelBase, customName, changeIndex);
				const entry = { id: entryId, name: effect.name, label, customName, description, autoDescription, actorType, target: actorType, hook, mode, bonus, modifier, set, threshold, evaluation, optin, requiredDamageTypes, addTo, isAura: true, auraUuid: effect.uuid, auraTokenUuid: token.document.uuid, distance: _getDistance(token, subjectToken), changeIndex, effectUuid: effect.uuid };
				if (mode === 'range') entry.range = parseRangeData({ key: el.key, value: el.value, evaluationData: auraTokenEvaluationData, effect, isAura: true, debug });
				const sameType = validFlags.filter((e) => e.effectUuid === effect.uuid && e.hook === hook);
				applyIndexLabels(entry, sameType);
				pushUniqueValidFlag(entry);
			})
		);
	});
	if (evaluationData.auraActor) delete evaluationData.distanceTokenToAuraSource; //might be added in the data and we want it gone if not needed
	if (evaluationData.effectActor) delete evaluationData.effectActor;
	subject?.appliedEffects.filter((effect) => {
		evaluationData.effectActor = evaluationData.rollingActor;
		evaluationData.nonEffectActor = evaluationData.opponentActor;
		effect.changes.forEach((el, changeIndex) => {
			if (!effectChangesTest({ token: subjectToken, change: el, actorType: 'subject', hook, effect, updateArrays, evaluationData, changeIndex })) return;
			const { actorType, mode } = getActorAndModeType(el, false);
			if (!actorType || !mode) return;
			const debug = { effectUuid: effect.uuid, changeKey: el.key };
			const { bonus, modifier, set, threshold } = preEvaluateExpression({ value: el.value, mode, hook, effect, evaluationData, debug });
			const optin = el.value.toLowerCase().includes('optin');
			const customName = getCustomName(el.value);
			const requiredDamageTypes = getRequiredDamageTypes(el.value);
			const addTo = getAddTo(el.value);
			const description = getDescription(el.value);
			const autoDescription = !description && optin ? buildAutoDescription({ mode, hook, bonus, modifier, set, threshold }) : undefined;
			let valuesToEvaluate = el.value
				.split(';')
				.map((v) => v.trim())
				.filter((v) => {
					if (!v) return false;
					const [key] = v.split(/[:=]/).map((s) => s.trim());
					return !blacklist.has(key.toLowerCase());
				})
				.join(';');
			if (!valuesToEvaluate) valuesToEvaluate = mode === 'bonus' && !bonus ? 'false' : 'true';
			if (valuesToEvaluate.includes('effectOriginTokenId')) valuesToEvaluate = valuesToEvaluate.replaceAll('effectOriginTokenId', `"${_getEffectOriginToken(effect, 'id')}"`);

			const entryId = `${effect.uuid ?? effect.id}:${changeIndex}:${hook}:${actorType}`;
			const label = buildEntryLabel(effect.name, customName, changeIndex);
			const entry = {
				id: entryId,
				name: effect.name,
				label,
				customName,
				description,
				autoDescription,
				actorType,
				target: actorType,
				hook,
				mode,
				bonus,
				modifier,
				set,
				threshold,
				evaluation: getMode({ value: valuesToEvaluate, debug }),
				optin,
				requiredDamageTypes,
				addTo,
				changeIndex,
				effectUuid: effect.uuid,
			};
			if (mode === 'range') entry.range = parseRangeData({ key: el.key, value: el.value, evaluationData, effect, isAura: false, debug });
			const sameType = validFlags.filter((e) => e.effectUuid === effect.uuid && e.hook === hook);
			applyIndexLabels(entry, sameType);
			pushUniqueValidFlag(entry);
		});
	});
	if (evaluationData.effectActor) delete evaluationData.effectActor;
	if (evaluationData.nonEffectActor) delete evaluationData.nonEffectActor;
	if (opponent) {
		evaluationData.effectActor = evaluationData.opponentActor;
		evaluationData.nonEffectActor = evaluationData.rollingActor;
		opponent.appliedEffects.filter((effect) =>
		effect.changes.forEach((el, changeIndex) => {
			if (!effectChangesTest({ token: opponentToken, change: el, actorType: 'opponent', hook, effect, updateArrays, evaluationData, changeIndex })) return;
				const { actorType, mode } = getActorAndModeType(el, false);
				if (!actorType || !mode) return;
				const debug = { effectUuid: effect.uuid, changeKey: el.key };
				const { bonus, modifier, set, threshold } = preEvaluateExpression({ value: el.value, mode, hook, effect, evaluationData, debug });
				const optin = el.value.toLowerCase().includes('optin');
				const customName = getCustomName(el.value);
				const requiredDamageTypes = getRequiredDamageTypes(el.value);
				const addTo = getAddTo(el.value);
				const description = getDescription(el.value);
				const autoDescription = !description && optin ? buildAutoDescription({ mode, hook, bonus, modifier, set, threshold }) : undefined;
				let valuesToEvaluate = el.value
					.split(';')
					.map((v) => v.trim())
					.filter((v) => {
						if (!v) return false;
						const [key] = v.split(/[:=]/).map((s) => s.trim());
						return !blacklist.has(key.toLowerCase());
					})
					.join(';');
				if (!valuesToEvaluate) valuesToEvaluate = mode === 'bonus' && !bonus ? 'false' : 'true';
				if (valuesToEvaluate.includes('effectOriginTokenId')) valuesToEvaluate = valuesToEvaluate.replaceAll('effectOriginTokenId', `"${_getEffectOriginToken(effect, 'id')}"`);
				const entryId = `${effect.uuid ?? effect.id}:${changeIndex}:${hook}:${actorType}`;
				const label = buildEntryLabel(effect.name, customName, changeIndex);
				const entry = {
					id: entryId,
					name: effect.name,
					label,
					customName,
					description,
					autoDescription,
					actorType,
					target: actorType,
					hook,
					mode,
					bonus,
					modifier,
					set,
					threshold,
					evaluation: getMode({ value: valuesToEvaluate, debug }),
					optin,
					requiredDamageTypes,
					addTo,
					changeIndex,
					effectUuid: effect.uuid,
				};
				if (mode === 'range') entry.range = parseRangeData({ key: el.key, value: el.value, evaluationData, effect, isAura: false, debug });
				const sameType = validFlags.filter((e) => e.effectUuid === effect.uuid && e.hook === hook);
				applyIndexLabels(entry, sameType);
				pushUniqueValidFlag(entry);
			})
		);
	}
	if (foundry.utils.isEmpty(validFlags)) return ac5eConfig;

	const validActivityUpdates = [];
	const validActivityUpdatesGM = [];
	const validActorUpdates = [];
	const validActorUpdatesGM = [];
	const validEffectDeletions = [];
	const validEffectDeletionsGM = [];
	const validEffectUpdates = [];
	const validEffectUpdatesGM = [];
	const validItemUpdates = [];
	const validItemUpdatesGM = [];

	for (const entry of validFlags) {
		let { actorType, evaluation, mode, name, bonus, modifier, set, threshold, isAura, optin } = entry;
		if (mode.includes('skill') || mode.includes('tool')) mode = 'check';
		if (evaluation) {
			const pendingForEntry = updateArrays.pendingUses?.filter((u) => u.id === entry.id);
			if (pendingForEntry?.length) {
				ac5eConfig.pendingUses ??= [];
				for (const pending of pendingForEntry) ac5eConfig.pendingUses.push(pending);
			}
			const hasActivityUpdate = updateArrays.activityUpdates.find((u) => u.name === name);
			const hasActivityUpdateGM = updateArrays.activityUpdatesGM.find((u) => u.name === name);
			const hasActorUpdate = updateArrays.actorUpdates.find((u) => u.name === name);
			const hasActorUpdateGM = updateArrays.actorUpdatesGM.find((u) => u.name === name);
			const hasEffectDeletion = updateArrays.effectDeletions.find((u) => u.name === name);
			const hasEffectDeletionGM = updateArrays.effectDeletionsGM.find((u) => u.name === name);
			const hasEffectUpdate = updateArrays.effectUpdates.find((u) => u.name === name);
			const hasEffectUpdateGM = updateArrays.effectUpdatesGM.find((u) => u.name === name);
			const hasItemUpdate = updateArrays.itemUpdates.find((u) => u.name === name);
			const hasItemUpdateGM = updateArrays.itemUpdatesGM.find((u) => u.name === name);
			if (hasActivityUpdate) validActivityUpdates.push(hasActivityUpdate.context);
			if (hasActivityUpdateGM) validActivityUpdatesGM.push(hasActivityUpdateGM.context);
			if (hasActorUpdate) validActorUpdates.push(hasActorUpdate.context);
			if (hasActorUpdateGM) validActorUpdatesGM.push(hasActorUpdateGM.context);
			if (hasEffectDeletion) validEffectDeletions.push(hasEffectDeletion.uuid);
			if (hasEffectDeletionGM) validEffectDeletionsGM.push(hasEffectDeletionGM.uuid);
			if (hasEffectUpdate) validEffectUpdates.push(hasEffectUpdate.context);
			if (hasEffectUpdateGM) validEffectUpdatesGM.push(hasEffectUpdateGM.context);
			if (hasItemUpdate) validItemUpdates.push(hasItemUpdate.context);
			if (hasItemUpdateGM) validItemUpdatesGM.push(hasItemUpdateGM.context);
			if (['bonus', 'extraDice', 'diceUpgrade', 'diceDowngrade', 'range'].includes(mode)) ac5eConfig[actorType][mode].push(entry);
			else if (optin) ac5eConfig[actorType][mode].push(entry);
			else {
				const hasDecoratedLabel = Boolean(entry?.label && entry.label !== name);
				ac5eConfig[actorType][mode].push((isAura || hasDecoratedLabel) ? entry.label : name); // preserve index/custom labels
			}
			if (mode === 'bonus' || mode === 'targetADC' || mode === 'extraDice' || mode === 'diceUpgrade' || mode === 'diceDowngrade') {
				const configMode =
					mode === 'bonus' ? 'parts'
					: mode === 'targetADC' ? 'targetADC'
					: mode === 'extraDice' ? 'extraDice'
					: null;
				const entryValues = [];
				if (bonus) {
					if (bonus === 'info') continue;
					if (bonus.constructor?.metadata) bonus = String(bonus); // special case for rollingActor.scale.rogue['sneak-attack'] for example; returns the .formula
					if (typeof bonus === 'string') {
						const trimmedBonus = bonus.trim();
						const isDiceMultiplier = /^\+?\s*(?:x|\^)\s*-?\d+\s*$/i.test(trimmedBonus);
						if (!isDiceMultiplier && !(trimmedBonus.includes('+') || trimmedBonus.includes('-'))) bonus = `+${bonus}`;
					}
					entryValues.push(bonus);
				}
				if (set) entryValues.push(`${set}`);
				entry.values = entryValues;
				if (!optin && configMode) ac5eConfig[configMode].push(...entryValues);
			}
			if (modifier) {
				if (hook === 'damage') ac5eConfig.damageModifiers.push(modifier);
				else if (!optin) {
					let mod;
					if (modifier.includes('max')) {
						mod = Number(modifier.replace('max', ''));
						const inplaceMod = ac5eConfig.modifiers.maximum;
						if (mod) ac5eConfig.modifiers.maximum = !inplaceMod || inplaceMod > mod ? mod : inplaceMod;
					}
					if (modifier.includes('min')) {
						mod = Number(modifier.replace('min', ''));
						const inplaceMod = ac5eConfig.modifiers.minimum;
						if (mod) ac5eConfig.modifiers.minimum = !inplaceMod || inplaceMod < mod ? mod : inplaceMod;
					}
				}
			}
			if (mode === 'criticalThreshold') {
				if (threshold) {
					if (typeof threshold === 'string' && !(threshold.includes('+') || threshold.includes('-'))) threshold = `+${threshold}`;
					ac5eConfig.threshold.push(threshold);
				}
				if (set) ac5eConfig.threshold.push(`${set}`);
			}
			if (mode === 'fumbleThreshold') {
				if (threshold) {
					if (typeof threshold === 'string' && !(threshold.includes('+') || threshold.includes('-'))) threshold = `+${threshold}`;
					ac5eConfig.fumbleThreshold.push(threshold);
				}
				if (set) ac5eConfig.fumbleThreshold.push(`${set}`);
			}
		}
	}
	ac5eQueue
		.add(async () => {
			try {
				const allPromises = [];

				allPromises.push(
					...validEffectDeletions.map((uuid) => {
						const doc = fromUuidSync(uuid);
						return doc ? doc.delete() : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validEffectUpdates.map((v) => {
						const doc = fromUuidSync(v.uuid);
						return doc ? doc.update(v.updates) : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validItemUpdates.map((v) => {
						const doc = fromUuidSync(v.uuid);
						return doc ? doc.update(v.updates) : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validActorUpdates.map((v) => {
						const doc = fromUuidSync(v.uuid);
						return doc ? doc.update(v.updates, v.options) : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validActivityUpdates.map((v) => {
						const act = fromUuidSync(v.context.uuid);
						return act ? act.update(v.context.updates) : Promise.resolve(null);
					})
				);
				const settled = await Promise.allSettled(allPromises);

				const errors = settled
					.map((r, i) => ({ r, i }))
					.filter((x) => x.r.status === 'rejected')
					.map((x) => ({ index: x.i, reason: x.r.reason }));

				if (errors.length) {
					console.error('Some queued updates failed:', errors);
				}
			} catch (err) {
				console.error('Queued job error:', err);
				throw err; // rethrow so the queue's catch handler sees it
			}
		})
		.catch((err) => console.error('Queued job failed', err));

	_doQueries({ validActivityUpdatesGM, validActorUpdatesGM, validEffectDeletionsGM, validEffectUpdatesGM, validItemUpdatesGM });

	return ac5eConfig;

	//special functions\\
	function getMode({ value, auraTokenEvaluationData, debug }) {
		if (['1', 'true'].includes(value)) return true;
		if (['0', 'false'].includes(value)) return false;
		const clauses = value
			.split(';')
			.map((v) => v.trim())
			.filter(Boolean);
		if (settings.debug) console.log('AC5E._getMode:', { clauses });

		return clauses.some((clause) => {
			let mult = null;
			if (clause.startsWith('!') && !clause.includes('&') && !clause.includes('?') && !clause.includes('|')) {
				clause = clause.slice(1).trim();
				mult = '!';
			}
			const sandbox = auraTokenEvaluationData ? auraTokenEvaluationData : evaluationData;
			if (sandbox?._baseConstants) sandbox._flatConstants = { ...sandbox._baseConstants };
			const statusMap = sandbox?.effectActor?.statusesMap;
			if (statusMap) foundry.utils.mergeObject(sandbox._flatConstants, statusMap);
			const result = _ac5eSafeEval({ expression: clause, sandbox, mode: 'condition', debug });
			return mult ? !result : result;
		});
	}
}

function handleUses({ actorType, change, effect, evalData, updateArrays, debug, hook, changeIndex, auraTokenUuid }) {
	const pendingUpdates = {
		activityUpdates: [],
		activityUpdatesGM: [],
		actorUpdates: [],
		actorUpdatesGM: [],
		effectDeletions: [],
		effectDeletionsGM: [],
		effectUpdates: [],
		effectUpdatesGM: [],
		itemUpdates: [],
		itemUpdatesGM: [],
	};
	const { activityUpdates, activityUpdatesGM, actorUpdates, actorUpdatesGM, effectDeletions, effectDeletionsGM, effectUpdates, effectUpdatesGM, itemUpdates, itemUpdatesGM } = pendingUpdates;
	const isOwner = effect.isOwner;
	const values = change.value
		.split(';')
		.filter(Boolean)
		.map((v) => v.trim());
	const hasCount = getBlacklistedKeysValue('usescount', change.value);
	const isOnce = values.some((use) => use === 'once');
	const isOptin = values.some((use) => use === 'optin');
	if (!hasCount && !isOnce) {
		return true;
	}
	const effectId = effect.uuid ?? effect.id;
	const id = actorType === 'aura' && auraTokenUuid ? `${effectId}:${changeIndex}:${hook}:aura:${auraTokenUuid}` : `${effectId}:${changeIndex}:${hook}:${actorType}`;
	const isTransfer = effect.transfer;
	if (isOnce && !isTransfer) {
		if (isOwner) effectDeletions.push({ name: effect.name, uuid: effect.uuid });
		else effectDeletionsGM.push({ name: effect.name, uuid: effect.uuid });
	} else if (isOnce && isTransfer) {
		if (isOwner) effectUpdates.push({ name: effect.name, context: { uuid: effect.uuid, updates: { disabled: true } } });
		else effectUpdatesGM.push({ name: effect.name, context: { uuid: effect.uuid, updates: { disabled: true } } });
	} else if (hasCount) {
		const [consumptionTarget, ...consumptionValues] = hasCount.split(',').map((v) => v.trim()); // this can split Math.max(1,5) expressions.
		const consumptionValue = consumptionValues.join(',');
		const hasOrigin = consumptionTarget.includes('origin');
		let isNumber;
		if (!hasOrigin) isNumber = evalDiceExpression(hasCount);
		let consume = 1; //consume Integer or 1; usage: usesCount=5,2 meaning consume 2 uses per activation. Can be negative, giving back.
		if (consumptionValue) {
			let evaluated = evalDiceExpression(consumptionValue);
			if (!isNaN(evaluated)) consume = evaluated;
			else {
				evaluated = _ac5eSafeEval({ expression: consumptionValue, sandbox: evalData, mode: 'formula', debug });
				if (!isNaN(evaluated)) consume = evaluated;
				else {
					evaluated = evalDiceExpression(evaluated);
					if (!isNaN(evaluated)) consume = evaluated;
					else consume = 1;
				}
			}
		}

		if (!isNaN(isNumber)) {
			if (isNumber === 0) {
				return false;
			}

			const newUses = isNumber - consume;

			if (newUses < 0) return false; //if you need to consume more uses than available (can only happen if moreUses exists)

			if (newUses === 0 && !isTransfer) {
				if (isOwner) effectDeletions.push({ name: effect.name, uuid: effect.uuid });
				else effectDeletionsGM.push({ name: effect.name, uuid: effect.uuid });
			} else {
				let changes = foundry.utils.duplicate(effect.changes);
				const index = changes.findIndex((c) => c.key === change.key);

				if (index >= 0) {
					changes[index].value = changes[index].value.replace(/\busesCount\s*[:=]\s*\d+/i, `usesCount=${newUses}`);

					if (!isTransfer) {
						if (isOwner) effectUpdates.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes } } });
						else effectUpdatesGM.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes } } });
					} else {
						const hasInitialUsesFlag = effect.getFlag('automated-conditions-5e', 'initialUses')?.[effect.id]?.initialUses;
						if (newUses === 0) {
							if (!hasInitialUsesFlag) {
								if (isOwner) effectUpdates.push({ name: effect.name, context: { uuid: effect.uuid, updates: { disabled: true } } });
								else effectUpdatesGM.push({ name: effect.name, context: { uuid: effect.uuid, updates: { disabled: true } } });
							} else {
								changes[index].value = changes[index].value.replace(/\busesCount\s*[:=]\s*\d+/i, `usesCount=${hasInitialUsesFlag}`);
								if (isOwner) effectUpdates.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes, disabled: true } } });
								else effectUpdatesGM.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes, disabled: true } } });
							}
						} else {
							if (!hasInitialUsesFlag) {
								if (isOwner) effectUpdates.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes, 'flags.automated-conditions-5e': { initialUses: { [effect.id]: { initialUses: isNumber } } } } } });
								else effectUpdatesGM.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes, 'flags.automated-conditions-5e': { initialUses: { [effect.id]: { initialUses: isNumber } } } } } });
							} else {
								if (isOwner) effectUpdates.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes } } });
								else effectUpdatesGM.push({ name: effect.name, context: { uuid: effect.uuid, updates: { changes } } });
							}
						}
					}
				}
			}
		} else {
			let itemActivityfromUuid = !!fromUuidSync(consumptionTarget) && fromUuidSync(consumptionTarget);
			if (hasOrigin) {
				if (!effect.origin) {
					ui.notifications.error(`You are using 'origin' in effect ${effect.name}, but you have created it directly on the actor and does not have an associated item or activity; Returning false in ac5e.handleUses;`);
					return false;
				} else {
					const parsed = foundry.utils.parseUuid(effect.origin);
					if (parsed.type === 'ActiveEffect') {
						// most of the time that will be an appliedEffect and the origin should be correct and not pointing to game.actors.
						itemActivityfromUuid = fromUuidSync(itemActivityfromUuid).parent;
					} else if (parsed.type === 'Item') {
						const i = fromUuidSync(effect.origin);
						const actorLinked = i?.parent?.protoTypeToken?.actorLink; //when can "i" be undefined? Origin can be null
						if (actorLinked) itemActivityfromUuid = i;
						else itemActivityfromUuid = fromUuidSync(effect.parent.uuid);
					}
				}
			}
			if (itemActivityfromUuid) {
				const item = itemActivityfromUuid instanceof Item && itemActivityfromUuid;
				const activity = !item && itemActivityfromUuid.type !== 'undefined' && itemActivityfromUuid;
				const currentUses = item ? item.system.uses.value : activity ? activity.uses.value : false;
				const currentQuantity = item && !item.system.uses.max ? item.system.quantity : false;
				if (currentUses === false && currentQuantity === false) return false;
				const updated = updateUsesCount({ effect, item, activity, currentUses, currentQuantity, consume, activityUpdates, activityUpdatesGM, itemUpdates, itemUpdatesGM });
				if (!updated) return false;
			} else {
				const actor = effect.target;
				if (!(actor instanceof Actor) || !actor.system?.isCreature) return false;
				if (consumptionTarget.startsWith('Item.')) {
					const str = consumptionTarget.replace(/[\s,]+$/, '');
					const match = str.match(/^Item\.([^,]+(?:,\s*[^,]+)*)(?:\.Activity\.([^,\s]+))?/);
					if (match) {
						const itemID = match[1];
						const activityID = match[2] ?? null;

						const document = _getItemOrActivity(itemID, activityID, actor);
						if (!document) return false;
						let item, activity;
						if (document instanceof Item) item = document;
						else {
							activity = document;
							item = activity.item;
						}
						const currentUses = item ? item.system.uses.value : activity ? activity.uses.value : false;
						const currentQuantity = item && !item.system.uses.max ? item.system.quantity : false;
						if (currentUses === false && currentQuantity === false) return false;
						const updated = updateUsesCount({ effect, item, activity, currentUses, currentQuantity, consume, activityUpdates, activityUpdatesGM, itemUpdates, itemUpdatesGM });
						if (!updated) return false;
					} else return false;
				} else {
					/*if (['hp', 'hd', 'exhaustion', 'inspiration', 'death', 'currency', 'spell', 'resources', 'walk'].includes(commaSeparated[0].toLowerCase()))*/
					const consumptionActor = consumptionTarget.startsWith('opponentActor') || consumptionTarget.startsWith('targetActor') ? evalData.opponentActor : consumptionTarget.startsWith('auraActor') ? evalData.auraActor : consumptionTarget.startsWith('rollingActor') ? evalData.rollingActor : actor.getRollData(); //  actor is the effectActor
					const uuid = consumptionActor.uuid ?? actor.uuid;
					if (consumptionTarget.includes('flag')) {
						let value = consumptionTarget.startsWith('flag') ? foundry.utils.getProperty(consumptionActor, consumptionTarget) : foundry.utils.getProperty(evalData, consumptionTarget);
						if (!Number(value)) value = 0;
						const newValue = value - consume;
						if (newValue < 0) return false;
						if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { [`${consumptionTarget}`]: newValue } } });
						else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { [`${consumptionTarget}`]: newValue } } });
					} else {
						const attr = consumptionTarget.toLowerCase();
						if (attr.includes('death')) {
							const type = attr.includes('fail') ? 'attributes.death.failure' : 'attributes.success.failure';
							const value = foundry.utils.getProperty(actor, type);
							const newValue = value + consume;
							if (newValue < 0 || newValue > 3) return false;
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { [`system.${type}`]: newValue } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { [`system.${type}`]: newValue } } });
						} else if (attr.includes('hpmax')) {
							const { tempmax, max, value } = consumptionActor.attributes.hp;
							const newTempmax = tempmax - consume;
							if (max - newTempmax < 0) return false; //@to-do, allow when opt-ins are implemented (with an asterisk that it would drop the user unconscious if used)!
							const noConcentration = !(max + newTempmax >= value || change.value.toLowerCase().includes('noconc')); //shouldn't trigger concentration check if it wouldn't lead to hp drop or user indicated
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.hp.tempmax': newTempmax }, options: { dnd5e: { concentrationCheck: noConcentration } } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.hp.tempmax': newTempmax }, options: { dnd5e: { concentrationCheck: noConcentration } } } });
						} else if (attr.includes('hptemp')) {
							const { temp } = consumptionActor.attributes.hp;
							const newTemp = temp - consume;
							if (newTemp < 0) return false;
							const noConcentration = !(newTemp >= temp || change.value.toLowerCase().includes('noconc')); //shouldn't trigger concentration check if it wouldn't lead to temphp drop or user indicated
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.hp.temp': newTemp }, options: { dnd5e: { concentrationCheck: noConcentration } } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.hp.temp': newTemp }, options: { dnd5e: { concentrationCheck: noConcentration } } } });
						} else if (attr.includes('hp')) {
							const { value, effectiveMax } = consumptionActor.attributes.hp;
							const newValue = value - consume;
							if (newValue < 0 || newValue > effectiveMax) return false; //@to-do, allow when opt-ins are implemented (with an asterisk that it would drop the user unconscious if used)!
							const noConcentration = !(newValue >= value || change.value.toLowerCase().includes('noconc')); //shouldn't trigger concentration check if it wouldn't lead to hp drop or user indicated
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.hp.value': newValue }, options: { dnd5e: { concentrationCheck: noConcentration } } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.hp.value': newValue }, options: { dnd5e: { concentrationCheck: noConcentration } } } });
						} else if (attr.includes('exhaustion')) {
							const value = consumptionActor.attributes.exhaustion;
							const newValue = value - consume;
							const max = CONFIG.statusEffects.find((s) => s.id === 'exhaustion')?.levels || Infinity;
							if (newValue < 0 || newValue > max) return false; //@to-do, allow when opt-ins are implemented (with an asterisk that it would drop the user unconscious if used)!
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.exhaustion': newValue } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.exhaustion': newValue } } });
						} else if (attr.includes('inspiration')) {
							const value = consumptionActor.attributes.inspiration ? 1 : 0;
							const newValue = value - consume;
							if (newValue < 0 || newValue > 1) return false; //@to-do: double check logic
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.inspiration': !!newValue } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { 'system.attributes.inspiration': !!newValue } } });
						} else if (attr.includes('hd')) {
							const { max, value, classes } = consumptionActor.attributes.hd;
							if (value - consume < 0 || value - consume > max) return false;

							const hdClasses = Array.from(classes)
								.sort((a, b) => Number(a.system.hd.denomination.split('d')[1]) - Number(b.system.hd.denomination.split('d')[1]))
								.map((item) => ({ uuid: item.uuid, id: item.id, hd: item.system.hd }));

							const consumeLargest = attr.includes('large');
							const consumeSmallest = attr.includes('small');

							const type = consumeSmallest ? 'smallest' : consumeLargest ? 'largest' : consume > 0 ? 'smallest' : 'largest';
							let remaining = consume; // positive = consume, negative = give back
							const ownedUpdates = [];
							const gmUpdates = [];

							const pushUpdate = (uuid, id, newSpent) => {
								if (isOwner) ownedUpdates.push({ uuid, updates: { 'system.hd.spent': newSpent } });
								else gmUpdates.push({ uuid, updates: { 'system.hd.spent': newSpent } });
							};

							if (type === 'smallest') {
								if (remaining > 0) {
									// consume from available value
									let toConsume = remaining;
									for (let i = 0; i < hdClasses.length && toConsume > 0; i++) {
										const {
											uuid,
											id,
											hd: { max, value: val, spent },
										} = hdClasses[i];
										if (!val) continue;
										const take = Math.min(toConsume, val);
										const newSpent = spent + take;
										pushUpdate(uuid, id, newSpent);
										toConsume -= take;
									}
									remaining = toConsume;
								} else if (remaining < 0) {
									// give back (restore spent)
									let toRestore = Math.abs(remaining);
									for (let i = 0; i < hdClasses.length && toRestore > 0; i++) {
										const {
											uuid,
											id,
											hd: { spent },
										} = hdClasses[i];
										if (!spent) continue;
										const give = Math.min(toRestore, spent);
										const newSpent = spent - give;
										pushUpdate(uuid, id, newSpent);
										toRestore -= give;
									}
									remaining = -toRestore; // remaining negative if still need to restore
								}
							} else if (type === 'largest') {
								if (remaining > 0) {
									let toConsume = remaining;
									for (let i = hdClasses.length - 1; i >= 0 && toConsume > 0; i--) {
										const {
											uuid,
											id,
											hd: { max, value: val, spent },
										} = hdClasses[i];
										if (!val) continue;
										const take = Math.min(toConsume, val);
										const newSpent = spent + take;
										pushUpdate(uuid, id, newSpent);
										toConsume -= take;
									}
									remaining = toConsume;
								} else if (remaining < 0) {
									let toRestore = Math.abs(remaining);
									for (let i = hdClasses.length - 1; i >= 0 && toRestore > 0; i--) {
										const {
											uuid,
											id,
											hd: { spent },
										} = hdClasses[i];
										if (!spent) continue;
										const give = Math.min(toRestore, spent);
										const newSpent = spent - give;
										pushUpdate(uuid, id, newSpent);
										toRestore -= give;
									}
									remaining = -toRestore;
								}
							} else return false;
							if (isOwner) itemUpdates.push({ name: effect.name, context: ownedUpdates });
							else itemUpdatesGM.push({ name: effect.name, context: gmUpdates });
						} else {
							const availableResources = CONFIG.DND5E.consumableResources;
							const type = availableResources.find((r) => r.includes(attr));
							if (!type) return false;
							const resource = foundry.utils.getProperty(consumptionActor, type);
							let newValue;
							if (!resource) return false;
							else if (resource instanceof Object) {
								const { max, value } = resource;
								newValue = value - consume;
								if (newValue < 0 || newValue > max) return false;
							} else if (typeof resource === 'number') {
								newValue = value - consume;
								if (newValue < 0) return false;
							}
							if (isOwner) actorUpdates.push({ name: effect.name, context: { uuid, updates: { [`system.${type}`]: newValue } } });
							else actorUpdatesGM.push({ name: effect.name, context: { uuid, updates: { [`system.${type}`]: newValue } } });
						}
					}
				}
			}
		}
		const hasPendingUpdates = Object.values(pendingUpdates).some((updates) => updates.length);
		if (hasPendingUpdates) {
			updateArrays.pendingUses.push({ id, name: effect.name, optin: isOptin, ...pendingUpdates });
		}
		return true;
	}
}

export function _applyPendingUses(pendingUses = []) {
	if (!pendingUses?.length) return;
	const validActivityUpdates = [];
	const validActivityUpdatesGM = [];
	const validActorUpdates = [];
	const validActorUpdatesGM = [];
	const validEffectDeletions = [];
	const validEffectDeletionsGM = [];
	const validEffectUpdates = [];
	const validEffectUpdatesGM = [];
	const validItemUpdates = [];
	const validItemUpdatesGM = [];
	const pushContexts = (entries, target) => {
		for (const entry of entries ?? []) {
			const context = entry?.context ?? entry;
			if (context) target.push(context);
		}
	};

	for (const pending of pendingUses) {
		pushContexts(pending.activityUpdates, validActivityUpdates);
		pushContexts(pending.activityUpdatesGM, validActivityUpdatesGM);
		pushContexts(pending.actorUpdates, validActorUpdates);
		pushContexts(pending.actorUpdatesGM, validActorUpdatesGM);
		validEffectDeletions.push(...(pending.effectDeletions ?? []));
		validEffectDeletionsGM.push(...(pending.effectDeletionsGM ?? []));
		pushContexts(pending.effectUpdates, validEffectUpdates);
		pushContexts(pending.effectUpdatesGM, validEffectUpdatesGM);
		pushContexts(pending.itemUpdates, validItemUpdates);
		pushContexts(pending.itemUpdatesGM, validItemUpdatesGM);
	}

	ac5eQueue
		.add(async () => {
			try {
				const allPromises = [];

				allPromises.push(
					...validEffectDeletions.map((uuid) => {
						const doc = fromUuidSync(uuid);
						return doc ? doc.delete() : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validEffectUpdates.map((v) => {
						const doc = fromUuidSync(v.uuid);
						return doc ? doc.update(v.updates) : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validItemUpdates.map((v) => {
						const doc = fromUuidSync(v.uuid);
						return doc ? doc.update(v.updates) : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validActorUpdates.map((v) => {
						const doc = fromUuidSync(v.uuid);
						return doc ? doc.update(v.updates, v.options) : Promise.resolve(null);
					})
				);
				allPromises.push(
					...validActivityUpdates.map((v) => {
						const act = fromUuidSync(v.context.uuid);
						return act ? act.update(v.context.updates) : Promise.resolve(null);
					})
				);
				const settled = await Promise.allSettled(allPromises);

				const errors = settled
					.map((r, i) => ({ r, i }))
					.filter((x) => x.r.status === 'rejected')
					.map((x) => ({ index: x.i, reason: x.r.reason }));

				if (errors.length) {
					console.error('Some queued updates failed:', errors);
				}
			} catch (err) {
				console.error('Queued job error:', err);
				throw err;
			}
		})
		.catch((err) => console.error('Queued job failed', err));

	_doQueries({ validActivityUpdatesGM, validActorUpdatesGM, validEffectDeletionsGM, validEffectUpdatesGM, validItemUpdatesGM });
}

function updateUsesCount({ effect, item, activity, currentUses, currentQuantity, consume, activityUpdates, activityUpdatesGM, itemUpdates, itemUpdatesGM }) {
	const newUses = currentUses !== false ? currentUses - consume : -1;
	const newQuantity = currentQuantity !== false ? currentQuantity - consume : -1;
	if (newUses < 0 && newQuantity < 0) return false;
	if (newUses !== -1) {
		const spent = (item?.system?.uses?.max ?? activity?.uses?.max) - newUses;
		if (item?.isOwner) {
			if (item) itemUpdates.push({ name: effect.name, context: { uuid: item.uuid, updates: { 'system.uses.spent': spent } } });
			else if (activity) activityUpdates.push({ name: effect.name, context: { uuid: activity.uuid, updates: { 'uses.spent': spent } } });
		} else {
			if (item) itemUpdatesGM.push({ name: effect.name, context: { uuid: item.uuid, updates: { 'system.uses.spent': spent } } });
			else if (activity) activityUpdatesGM.push({ name: effect.name, context: { uuid: activity.uuid, updates: { 'uses.spent': spent } } });
		}
	} else if (newQuantity !== -1) {
		const quantity = item.system?.quantity - newQuantity;
		if (item.isOwner) itemUpdates.push({ name: effect.name, context: { uuid: item.uuid, updates: { 'system.quantity': quantity } } });
		else itemUpdatesGM.push({ name: effect.name, context: { uuid: item.uuid, updates: { 'system.quantity': quantity } } });
	}
	return true;
}

function getBlacklistedKeysValue(key, values) {
	const regex = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.+)$`, 'i'); //matching usesCOunT: 6 or usesCount=6 and returning the value after the :=
	const parts = values
		.split(';')
		.map((e) => e.trim())
		.map((e) => regex.exec(e))
		.find(Boolean);
	return parts ? parts[1].trim() : '';
}

function bonusReplacements(expression, evalData, isAura, effect) {
	if (typeof expression !== 'string') return expression;
	// Short-circuit: skip if formula is just plain dice + numbers + brackets (no dynamic content)
	const isStaticFormula = /^[\d\s+\-*/().\[\]d]+$/i.test(expression) && !expression.includes('@') && !expression.includes('Actor') && !expression.includes('##');

	if (isStaticFormula) return expression;
	const effectSpellLevel = Number(foundry.utils.getProperty(effect, 'flags.dnd5e.spellLevel'));
	const effectScaling = Number(foundry.utils.getProperty(effect, 'flags.dnd5e.scaling'));
	const spellLevel = Number.isFinite(effectSpellLevel) ? effectSpellLevel : (evalData.castingLevel ?? 0);
	const scaling = Number.isFinite(effectScaling) ? effectScaling : (evalData.scaling ?? 0);

	const staticMap = {
		'@scaling': scaling,
		scaling: scaling,
		'@spellLevel': spellLevel,
		spellLevel: spellLevel,
		'@castingLevel': spellLevel,
		castingLevel: spellLevel,
		'@baseSpellLevel': evalData.baseSpellLevel ?? 0,
		baseSpellLevel: evalData.baseSpellLevel ?? 0,
		effectStacks: effect.flags?.dae?.stacks ?? effect.flags?.statuscounter?.value ?? 1,
		stackCount: effect.flags?.dae?.stacks ?? effect.flags?.statuscounter?.value ?? 1,
	};

	const pattern = new RegExp(Object.keys(staticMap).join('|'), 'g');
	expression = expression.replace(pattern, (match) => staticMap[match]);
	if (expression.includes('@')) expression = isAura ? expression.replaceAll('@', 'auraActor.') : expression.replaceAll('@', 'rollingActor.');
	if (expression.includes('##')) expression = isAura ? expression.replaceAll('##', 'rollingActor.') : expression.replaceAll('##', 'opponentActor.');
	if (expression.includes('effectOriginActor')) {
		const tok = _getEffectOriginToken(effect, 'token');
		evalData.effectOriginActor = _ac5eActorRollData(tok);
	}
	return expression;
}

function preEvaluateExpression({ value, mode, hook, effect, evaluationData, isAura, debug }) {
	let bonus, set, modifier, threshold;
	const isBonus = value.includes('bonus') && (mode === 'bonus' || mode === 'targetADC' || mode === 'extraDice' || mode === 'diceUpgrade' || mode === 'diceDowngrade' || mode === 'range') ? getBlacklistedKeysValue('bonus', value) : false;
	if (isBonus) {
		const replacementBonus = bonusReplacements(isBonus, evaluationData, isAura, effect);
		bonus = _ac5eSafeEval({ expression: replacementBonus, sandbox: evaluationData, mode: 'formula', debug });
	}
	const isSet = value.includes('set') && (mode === 'bonus' || mode === 'targetADC' || (['criticalThreshold', 'fumbleThreshold'].includes(mode) && hook === 'attack')) ? getBlacklistedKeysValue('set', value) : false;
	if (isSet) {
		const replacementBonus = bonusReplacements(isSet, evaluationData, isAura, effect);
		set = _ac5eSafeEval({ expression: replacementBonus, sandbox: evaluationData, mode: 'formula', debug });
	}
	const isModifier = value.includes('modifier') && mode === 'modifiers' ? getBlacklistedKeysValue('modifier', value) : false;
	if (isModifier) {
		const replacementModifier = bonusReplacements(isModifier, evaluationData, isAura, effect);
		modifier = _ac5eSafeEval({ expression: replacementModifier, sandbox: evaluationData, mode: 'formula', debug });
	}
	const isThreshold = value.includes('threshold') && hook === 'attack' ? getBlacklistedKeysValue('threshold', value) : false;
	if (isThreshold) {
		const replacementThreshold = bonusReplacements(isThreshold, evaluationData, isAura, effect);
		threshold = _ac5eSafeEval({ expression: replacementThreshold, sandbox: evaluationData, mode: 'formula', debug });
	}
	if (threshold) threshold = Number(evalDiceExpression(threshold)); // we need Integers to differentiate from set
	if (bonus && mode !== 'bonus') bonus = Number(evalDiceExpression(bonus)); // we need Integers in everything except for actual bonuses which are formulas and will be evaluated as needed in ac5eSafeEval
	if (set) set = String(evalDiceExpression(set)); // we need Strings for set
	if (ac5e?.debugTargetADC && mode === 'targetADC') console.warn('AC5E targetADC: preEvaluate', { hook, value, bonus, set, threshold, effect: effect?.name });
	return { bonus, set, modifier, threshold };
}

function evalDiceExpression(expr, { maxDice = 100, maxSides = 1000, debug = ac5e.debugEvaluations } = {}) {
	// expanded logic for unary minus: `((1d4) - 1)` returns from formulas like -1d4
	if (typeof expr === 'number') return expr;
	if (typeof expr !== 'string') return NaN;

	const allowed = /^[0-9dc+\-*\s()]+$/i; // added 1dc for coin flips
	if (!allowed.test(expr)) {
		if (debug) console.warn(`${Constants.MODULE_ID} - evalDiceExpression: Invalid characters in expression: "${expr}"`);
		return NaN;
	}

	const diceRe = /(\d*)d(\d+|c)/gi; // added 1dc for coin flips
	const diceLogs = [];

	const replaced = expr.replace(diceRe, (match, cStr, sStr) => {
		const count = Math.min(Math.max(parseInt(cStr || '1'), 0), maxDice);
		const isCoin = sStr.toLowerCase() === 'c';
		const sides = Math.min(Math.max(parseInt(sStr), 1), maxSides);

		let sum = 0;
		const rolls = [];
		for (let i = 0; i < count; i++) {
			let r;
			if (isCoin) {
				r = Math.random() < 0.5 ? 1 : 0;
				rolls.push(r ? 'H' : 'T');
			} else {
				r = Math.floor(Math.random() * sides) + 1;
				rolls.push(r);
			}
			sum += r;
		}

		if (debug) diceLogs.push(`${Constants.MODULE_ID} - evalDiceExpression: ${match} → [${rolls.join(', ')}] = ${sum}`);
		return String(sum);
	});

	function evaluateMath(input) {
		// Tokenize
		const tokens = [];
		const re = /\s*([0-9]+|\S)\s*/g;
		let m;
		let lastWasOp = true;

		while ((m = re.exec(input)) !== null) {
			const t = m[1];

			if (/^[0-9]+$/.test(t)) {
				tokens.push({ type: 'num', value: Number(t) });
				lastWasOp = false;
			} else if ('+-*()'.includes(t)) {
				if (t === '-' && lastWasOp) {
					tokens.push({ type: 'op', value: 'u-' }); // unary minus
				} else {
					tokens.push({ type: 'op', value: t });
					lastWasOp = t !== ')';
				}
				if (t === '(') lastWasOp = true;
			} else {
				return NaN;
			}
		}

		const prec = { 'u-': 3, '*': 2, '+': 1, '-': 1 };
		const assoc = { 'u-': 'right', '*': 'left', '+': 'left', '-': 'left' };

		const out = [];
		const ops = [];

		for (const tk of tokens) {
			if (tk.type === 'num') out.push(tk);
			else if (tk.value === '(') ops.push(tk);
			else if (tk.value === ')') {
				while (ops.length && ops[ops.length - 1].value !== '(') out.push(ops.pop());
				ops.pop(); // remove '('
			} else {
				const o1 = tk.value;
				while (ops.length) {
					const o2 = ops[ops.length - 1].value;
					if (o2 === '(') break;
					if (prec[o2] > prec[o1] || (prec[o2] === prec[o1] && assoc[o1] === 'left')) out.push(ops.pop());
					else break;
				}
				ops.push(tk);
			}
		}

		while (ops.length) out.push(ops.pop());

		// Evaluate RPN
		const stack = [];
		for (const tk of out) {
			if (tk.type === 'num') stack.push(tk.value);
			else {
				if (tk.value === 'u-') {
					stack.push(-stack.pop());
					continue;
				}
				const b = stack.pop();
				const a = stack.pop();
				if (tk.value === '+') stack.push(a + b);
				else if (tk.value === '-') stack.push(a - b);
				else if (tk.value === '*') stack.push(a * b);
			}
		}

		return stack.length === 1 ? stack[0] : NaN;
	}

	const result = evaluateMath(replaced);

	if (debug) {
		console.warn(`${Constants.MODULE_ID} - evalDiceExpression("${expr}") = ${result}`);
		console.warn(`${Constants.MODULE_ID} - evalDiceExpression Dice:`, diceLogs);
	}

	return result;
}
