import { _ac5eActorRollData, _ac5eSafeEval, _activeModule, _canSee, _calcAdvantageMode, _createEvaluationSandbox, _dispositionCheck, _getActionType, _getActivityEffectsStatusRiders, _getDistance, _getEffectOriginToken, _hasAppliedEffects, _hasStatuses, _localize, _i18nConditions, _autoArmor, _autoEncumbrance, _autoRanged, _raceOrType, _staticID } from './ac5e-helpers.mjs';
import Constants from './ac5e-constants.mjs';
import Settings from './ac5e-settings.mjs';

const settings = new Settings();

export function _ac5eChecks({ ac5eConfig, subjectToken, opponentToken }) {
	//ac5eConfig.options {ability, activity, distance, hook, skill, tool, isConcentration, isDeathSave, isInitiative}
	const { options } = ac5eConfig;
	const actorTokens = {
		subject: subjectToken?.actor,
		opponent: opponentToken?.actor,
	};

	for (const [type, actor] of Object.entries(actorTokens)) {
		if (foundry.utils.isEmpty(actor)) continue;
		const isSubjectExhausted = settings.autoExhaustion && type === 'subject' && actor?.statuses.has('exhaustion');
		const exhaustionLvl = isSubjectExhausted && actor.system?.attributes.exhaustion >= 3 ? 3 : 1;
		const tables = testStatusEffectsTables({ ac5eConfig, subjectToken, opponentToken, exhaustionLvl, type });

		for (const status of actor.statuses) {
			const test = status === 'exhaustion' && isSubjectExhausted ? tables?.[status]?.[exhaustionLvl]?.[options.hook]?.[type] : tables?.[status]?.[options.hook]?.[type];

			if (!test) continue;
			if (settings.debug) console.log(type, test);
			const effectName = tables?.[status]?.name;
			if (effectName) ac5eConfig[type][test].push(effectName);
		}
	}

	ac5eConfig = ac5eFlags({ ac5eConfig, subjectToken, opponentToken });
	if (settings.debug) console.log('AC5E._ac5eChecks:', { ac5eConfig });
	return ac5eConfig;
}

function testStatusEffectsTables({ ac5eConfig, subjectToken, opponentToken, exhaustionLvl, type } = {}) {
	const { ability, activity, distance, hook, isConcentration, isDeathSave, isInitiative } = ac5eConfig.options;

	const subject = subjectToken?.actor;
	const opponent = opponentToken?.actor;
	const modernRules = settings.dnd5eModernRules;
	const item = activity?.item;

	const mkStatus = (id, name, data) => ({ _id: _staticID(id), name, ...data });

	const hasStatusFromOpponent = (actor, status, origin) => actor?.appliedEffects.some((effect) => effect.statuses.has(status) && effect.origin && _getEffectOriginToken(effect, 'token')?.actor.uuid === origin?.uuid);

	const checkEffect = (status, mode) => (hasStatusFromOpponent(subject, status, opponent) ? mode : '');

	const isFrightenedByVisibleSource = () => {
		if (type !== 'subject') return false;
		const frightenedEffects = subject?.appliedEffects.filter((effect) => effect.statuses.has('frightened') && effect.origin);
		if (subject?.statuses.has('frightened') && !frightenedEffects.length) return true; //if none of the effects that apply frightened status on the actor have an origin, force true
		return frightenedEffects.some((effect) => {
			const originToken = _getEffectOriginToken(effect, 'token'); //undefined if no effect.origin
			return originToken && _canSee(subjectToken, originToken);
		});
	};

	const subjectMove = Object.values(subject?.system.attributes.movement || {}).some((v) => typeof v === 'number' && v);
	const opponentMove = Object.values(opponent?.system.attributes.movement || {}).some((v) => typeof v === 'number' && v);
	const subjectAlert2014 = !modernRules && subject?.items.some((item) => item.name.includes(_localize('AC5E.Alert')));
	const opponentAlert2014 = !modernRules && opponent?.items.some((item) => item.name.includes(_localize('AC5E.Alert')));

	const tables = {
		blinded: mkStatus('blinded', _i18nConditions('Blinded'), {
			attack: {
				subject: !_canSee(subjectToken, opponentToken) ? 'disadvantage' : '',
				opponent: !_canSee(opponentToken, subjectToken) && !subjectAlert2014 ? 'advantage' : '',
			},
		}),

		charmed: mkStatus('charmed', _i18nConditions('Charmed'), {
			check: { subject: checkEffect('charmed', 'advantage') },
			use: { subject: checkEffect('charmed', 'fail') },
		}),

		deafened: mkStatus('deafened', _i18nConditions('Deafened'), {}),

		exhaustion: mkStatus('exhaustion', `${_i18nConditions('Exhaustion')} ${exhaustionLvl}`, {
			1: { check: { subject: 'disadvantage' } },
			3: {
				check: { subject: 'disadvantage' },
				save: { subject: 'disadvantage' },
				attack: { subject: 'disadvantage' },
			},
		}),

		frightened: mkStatus('frightened', _i18nConditions('Frightened'), {
			attack: { subject: isFrightenedByVisibleSource() ? 'disadvantage' : '' },
			check: { subject: isFrightenedByVisibleSource() ? 'disadvantage' : '' },
		}),

		incapacitated: mkStatus('incapacitated', _i18nConditions('Incapacitated'), {
			use: { subject: ['action', 'bonus', 'reaction'].includes(activity?.activation?.type) ? 'fail' : '' },
			check: { subject: modernRules && isInitiative ? 'disadvantage' : '' },
		}),

		invisible: mkStatus('invisible', _i18nConditions('Invisible'), {
			attack: {
				subject: !opponentAlert2014 && !_canSee(opponentToken, subjectToken) ? 'advantage' : '',
				opponent: !_canSee(subjectToken, opponentToken) ? 'disadvantage' : '',
			},
			check: { subject: modernRules && isInitiative ? 'advantage' : '' },
		}),

		paralyzed: mkStatus('paralyzed', _i18nConditions('Paralyzed'), {
			save: { subject: ['str', 'dex'].includes(ability) ? 'fail' : '' },
			attack: { opponent: 'advantage' },
			damage: { opponent: activity?.hasDamage && distance <= 5 ? 'critical' : '' },
		}),

		petrified: mkStatus('petrified', _i18nConditions('Petrified'), {
			save: { subject: ['str', 'dex'].includes(ability) ? 'fail' : '' },
			attack: { opponent: 'advantage' },
		}),

		poisoned: mkStatus('poisoned', _i18nConditions('Poisoned'), {
			attack: { subject: 'disadvantage' },
			check: { subject: 'disadvantage' },
		}),

		prone: mkStatus('prone', _i18nConditions('Prone'), {
			attack: {
				subject: 'disadvantage',
				opponent: distance <= 5 ? 'advantage' : 'disadvantage',
			},
		}),

		restrained: mkStatus('restrained', _i18nConditions('Restrained'), {
			attack: { subject: 'disadvantage', opponent: 'advantage' },
			save: { subject: ability === 'dex' ? 'disadvantage' : '' },
		}),

		silenced: mkStatus('silenced', _i18nConditions('Silenced'), {
			use: { subject: item?.system.properties.has('vocal') ? 'fail' : '' },
		}),

		stunned: mkStatus('stunned', _i18nConditions('Stunned'), {
			attack: { opponent: 'advantage' },
			save: { subject: ['dex', 'str'].includes(ability) ? 'fail' : '' },
		}),

		unconscious: mkStatus('unconscious', _i18nConditions('Unconscious'), {
			attack: { opponent: 'advantage' },
			damage: { opponent: activity?.hasDamage && distance <= 5 ? 'critical' : '' },
			save: { subject: ['dex', 'str'].includes(ability) ? 'fail' : '' },
		}),
	};

	if (modernRules) {
		tables.surprised = mkStatus('surprised', _i18nConditions('Surprised'), {
			check: { subject: isInitiative ? 'disadvantage' : '' },
		});
		tables.grappled = mkStatus('grappled', _i18nConditions('Grappled'), {
			attack: {
				subject: subject?.appliedEffects.some((e) => e.statuses.has('grappled') && (!e.origin || _getEffectOriginToken(e, 'token') !== opponentToken)) ? 'disadvantage' : '',
			},
		});
	}

	if (settings.expandedConditions) {
		tables.dodging = mkStatus('dodging', _i18nConditions('Dodging'), {
			attack: {
				opponent: opponentToken && subject && _canSee(opponentToken, subjectToken) && !opponent?.statuses.has('incapacitated') && opponentMove ? 'disadvantage' : '',
			},
			save: {
				subject: ability === 'dex' && subject && !subject?.statuses.has('incapacitated') && subjectMove ? 'advantage' : '',
			},
		});

		tables.hiding = mkStatus('hiding', _i18nConditions('Hiding'), {
			attack: { subject: !opponentAlert2014 ? 'advantage' : '', opponent: 'disadvantage' },
			check: { subject: modernRules && isInitiative ? 'advantage' : '' },
		});

		tables.raging = mkStatus('raging', _localize('AC5E.Raging'), {
			save: {
				subject: ability === 'str' && subject?.armor?.system.type.value !== 'heavy' ? 'advantage' : '',
			},
			check: {
				subject: ability === 'str' && subject?.armor?.system.type.value !== 'heavy' ? 'advantage' : '',
			},
			use: { subject: item?.type === 'spell' ? 'fail' : '' },
		});

		tables.underwaterCombat = mkStatus('underwater', _localize('AC5E.UnderwaterCombat'), {
			attack: {
				subject: (_getActionType(activity) === 'mwak' && !subject?.system.attributes.movement.swim && !['dagger', 'javelin', 'shortsword', 'spear', 'trident'].includes(item?.system.type.baseItem)) || (_getActionType(activity) === 'rwak' && !['lightcrossbow', 'handcrossbow', 'heavycrossbow', 'net'].includes(item?.system.type.baseItem) && !item?.system.properties.has('thr') && distance <= activity?.range.value) ? 'disadvantage' : _getActionType(activity) === 'rwak' && distance > activity?.range.value ? 'fail' : '',
			},
		});
	}

	return tables;
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

	const distanceToSource = (token) => _getDistance(token, subjectToken);
	// const distanceToTarget = (token) => _getDistance(token, opponentToken);

	const evaluationData = _createEvaluationSandbox({ subjectToken, opponentToken, options });

	const getActorAndModeType = (el, includeAuras = false) => {
		let actorType, mode; //actorType designates which actor's rollData should this be evaluated upon; subject, opponent, aura
		const testTypes = el.key?.toLocaleLowerCase();
		if (testTypes.includes('grants')) actorType = 'opponent';
		else if (includeAuras && testTypes.includes('aura')) actorType = 'subject';
		else if (!testTypes.includes('aura') && !testTypes.includes('grants')) actorType = 'subject';
		if (testTypes.includes('dis')) mode = 'disadvantage';
		else if (testTypes.includes('adv')) mode = 'advantage';
		else if (testTypes.includes('thres')) mode = 'criticalThreshold';
		else if (testTypes.includes('crit')) mode = 'critical';
		else if (testTypes.includes('mod')) mode = 'modifiers';
		else if (testTypes.includes('fail')) mode = 'fail';
		else if (testTypes.includes('bonus')) mode = 'bonus';
		else if (testTypes.includes('success')) mode = 'success';
		else if (testTypes.includes('fumble')) mode = 'fumble';
		return { actorType, mode, isAll: el.key.includes('all') };
	};
	const validFlags = {};
	const inAuraRadius = (token, radius) => {
		//radius = radius?.match(/\d+$/)?.[0];  // no need anymore as we are evaluating the radius beforehand.
		if (!radius) return false;
		return distanceToSource(token) <= radius;
	};
	//Will return false only in case of both tokens being available AND the value includes allies OR enemies and the test of dispositionCheck returns false;
	const friendOrFoe = (tokenA, tokenB, value) => {
		if (!tokenA || !tokenB) return true;
		const alliesOrEnemies = value.includes('allies') ? 'allies' : value.includes('enemies') ? 'enemies' : null;
		if (!alliesOrEnemies) return true;
		return alliesOrEnemies === 'allies' ? _dispositionCheck(tokenA, tokenB, 'same') : !_dispositionCheck(tokenA, tokenB, 'same');
	};
	const effectChangesTest = ({ token = undefined, change, actorType, hook, effect, effectDeletions, effectUpdates, auraTokenEvaluationData, evaluationData }) => {
		const isAC5eFlag = ['ac5e', 'automated-conditions-5e'].some((scope) => change.key.includes(scope));
		if (!isAC5eFlag) return false;
		const hasHook = change.key.includes('all') || change.key.includes(hook) || (skill && change.key.includes('skill')) || (tool && change.key.includes('tool')) || (isConcentration && hook === 'save' && change.key.includes('conc')) || (isDeathSave && hook === 'save' && change.key.includes('death')) || (isInitiative && hook === 'check' && change.key.includes('init'));
		if (!hasHook) return false;
		const shouldProceedUses = handleUses({ actorType, change, effect, effectDeletions, effectUpdates });
		if (!shouldProceedUses) return false;
		if (change.value.toLocaleLowerCase().includes('itemLimited')) {
			if (evaluationData && evaluationData.item?.uuid === effect.origin) return true;
			else return false;
		}
		if (change.key.includes('aura')) {
			//isAura
			if (token === subjectToken) return change.value.includes('includeSelf');
			if (!friendOrFoe(token, subjectToken, change.value)) return false;
			let radius = getBlacklistedKeysValue('radius', change.value);
			if (radius) radius = _ac5eSafeEval({ expression: bonusReplacements(radius, auraTokenEvaluationData, true, effect), sandbox: auraTokenEvaluationData });
			if (inAuraRadius(token, radius)) return true;
			else return false;
		} else if (change.key.includes('grants')) {
			//isGrants
			if (actorType !== 'opponent') return false;
			if (!friendOrFoe(opponentToken, subjectToken, change.value)) return false;
			return true;
		} else {
			//isSelf
			if (actorType !== 'subject') return false;
			if (!friendOrFoe(opponentToken, subjectToken, change.value)) return false;
			return true;
		}
	};

	const bonusReplacements = (expression, evalData, isAura, effect) => {
		if (typeof expression !== 'string') return expression;
		// Short-circuit: skip if formula is just plain dice + numbers + brackets (no dynamic content)
		const isStaticFormula = /^[\d\s+\-*/().\[\]d]+$/i.test(expression) && !expression.includes('@') && !expression.includes('Actor') && !expression.includes('##');

		if (isStaticFormula) return expression;

		const staticMap = {
			'@scaling': evalData.scaling ?? 0,
			scaling: evalData.scaling ?? 0,
			'@spellLevel': evalData.castingLevel ?? 0,
			spellLevel: evalData.castingLevel ?? 0,
			'@castingLevel': evalData.castingLevel ?? 0,
			castingLevel: evalData.castingLevel ?? 0,
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
			if (tok?.actor) expression = Roll.fromTerms(Roll.parse(expression.replaceAll('effectOriginActor.', '@'), _ac5eActorRollData(tok))).formula;
		}
		if (expression.includes('rollingActor')) {
			const pattern = /\brollingActor(?:\.[a-zA-Z_$][\w$]*)+/g;
			expression = expression.replaceAll(pattern, (match) => {
				const replaced = match.replace('rollingActor.', '@');
				return Roll.fromTerms(Roll.parse(replaced, evalData.rollingActor)).formula;
			});
		}
		if (expression.includes('opponentActor')) {
			const pattern = /\bopponentActor(?:\.[a-zA-Z_$][\w$]*)+/g;
			expression = expression.replaceAll(pattern, (match) => {
				const replaced = match.replace('opponentActor.', '@');
				return Roll.fromTerms(Roll.parse(replaced, evalData.opponentActor)).formula;
			});
		}
		if (isAura && expression.includes('auraActor')) {
			const pattern = /\bauraActor(?:\.[a-zA-Z_$][\w$]*)+/g;
			expression = expression.replaceAll(pattern, (match) => {
				const replaced = match.replace('auraActor.', '@');
				return Roll.fromTerms(Roll.parse(replaced, evalData.auraActor)).formula;
			});
		}
		return expression;
	};

	const blacklist = ['bonus', 'radius', 'modifier', 'usesCount', 'threshold', 'singleAura', 'includeSelf', 'allies', 'enemies', 'once', 'itemLimited']; // bonus, radius, usesCount, threshold will be followed by : or =

	const effectDeletions = [];
	const effectUpdates = [];
	// const placeablesWithRelevantAuras = {};
	canvas.tokens.placeables.filter((token) => {
		if (!token.actor) return false;
		// if (token.actor.items.getName(_localize('AC5E.Items.AuraOfProtection'))) {
		// }
		const distanceTokenToAuraSource = distanceToSource(token);
		const currentCombatant = game.combat?.active ? game.combat.combatant?.tokenId : null;
		let auraTokenEvaluationData;
		if (foundry.utils.isNewerVersion(game.system.version, '5.0.0')) {
			//this is to save users from the numerous deprecation warnings for spell.mod and spell.dc when duplicating actors rollData, until v5...
			auraTokenEvaluationData = foundry.utils.mergeObject(
				evaluationData,
				{
					auraActor: _ac5eActorRollData(token),
					isAuraSourceTurn: currentCombatant === token?.id,
					auraTokenId: token.id,
				},
				{ inplace: false }
			);
		} else {
			auraTokenEvaluationData = evaluationData;
			auraTokenEvaluationData.auraActor = _ac5eActorRollData(token) || {};
			auraTokenEvaluationData.isAuraSourceTurn = currentCombatant === token?.id;
			auraTokenEvaluationData.auraTokenId = token.id;
		}
		token.actor.appliedEffects.filter((effect) =>
			effect.changes
				.filter((change) => effectChangesTest({ token, change, actorType: 'aura', hook, effect, effectDeletions, effectUpdates, auraTokenEvaluationData }))
				.forEach((el) => {
					const { actorType, mode } = getActorAndModeType(el, true);
					if (!actorType || !mode) return;
					let bonus, modifier, threshold;
					let isBonus = mode === 'bonus' ? getBlacklistedKeysValue('bonus', el.value) : false;
					if (isBonus) {
						const replacementBonus = bonusReplacements(isBonus, auraTokenEvaluationData, true, effect);
						if (isLiteralOrDiceExpression(replacementBonus)) bonus = replacementBonus.trim();
						else bonus = _ac5eSafeEval({ expression: replacementBonus, sandbox: auraTokenEvaluationData /*canBeStatic: true*/ });
					}
					const isModifier = mode === 'modifiers' ? getBlacklistedKeysValue('modifier', el.value) : false;
					if (isModifier) {
						const replacementModifier = bonusReplacements(isModifier, auraTokenEvaluationData, true, effect);
						modifier = _ac5eSafeEval({ expression: replacementModifier, sandbox: auraTokenEvaluationData /*canBeStatic: true*/ });
					}
					const isThreshold = hook === 'attack' ? getBlacklistedKeysValue('threshold', el.value) : false;
					if (isThreshold) {
						const replacementThreshold = bonusReplacements(isThreshold, auraTokenEvaluationData, true, effect);
						threshold = _ac5eSafeEval({ expression: replacementThreshold, sandbox: auraTokenEvaluationData /*canBeStatic: true*/ });
					}
					const auraOnlyOne = el.value.includes('singleAura');
					let valuesToEvaluate = el.value
						.split(';')
						.map((v) => v.trim())
						.filter((v) => {
							if (!v) return false;
							const [key] = v.split(/[:=]/).map((s) => s.trim());
							return !blacklist.includes(key);
						})
						.join(';');
					if (!valuesToEvaluate) valuesToEvaluate = 'true';
					if (valuesToEvaluate.includes('effectOriginTokenId')) valuesToEvaluate = valuesToEvaluate.replaceAll('effectOriginTokenId', `"${_getEffectOriginToken(effect, 'id')}"`);

					const evaluation = getMode({ value: valuesToEvaluate, auraTokenEvaluationData });
					if (!evaluation) return;

					if (auraOnlyOne) {
						const sameAuras = Object.keys(validFlags).filter((key) => key.includes(effect.name));
						if (sameAuras.length) {
							for (const aura of sameAuras) {
								const auraBonus = validFlags[aura].bonus;
								if ((!auraBonus.includes('d') && !bonus.includes('d') && auraBonus < bonus) || ((!auraBonus.includes('d') || !bonus.includes('d')) && validFlags[aura].distance > _getDistance(token, subjectToken))) {
									delete validFlags[aura];
								} else return true;
							}
						}
					}
					validFlags[`${effect.name} - Aura (${token.name})`] = { name: effect.name, actorType, mode, bonus, modifier, threshold, evaluation, isAura: true, auraUuid: effect.uuid, auraTokenUuid: token.document.uuid, distance: _getDistance(token, subjectToken) };
				})
		);
	});
	//cleanup for the line 324 workaround
	if (evaluationData.auraActor) {
		delete evaluationData.auraActor;
		delete evaluationData.isAuraSourceTurn;
		delete evaluationData.auraTokenId;
	}
	subject?.appliedEffects.filter((effect) =>
		effect.changes
			.filter((change) => effectChangesTest({ token: subjectToken, change, actorType: 'subject', hook, effect, effectDeletions, effectUpdates, evaluationData }))
			.forEach((el) => {
				const { actorType, mode } = getActorAndModeType(el, false);
				if (!actorType || !mode) return;
				let bonus, modifier, threshold;
				let isBonus = mode === 'bonus' ? getBlacklistedKeysValue('bonus', el.value) : false;
				if (isBonus) {
					const replacementBonus = bonusReplacements(isBonus, evaluationData, false, effect);
					if (isLiteralOrDiceExpression(replacementBonus)) bonus = replacementBonus.trim();
					else bonus = _ac5eSafeEval({ expression: replacementBonus, sandbox: evaluationData /*canBeStatic: true*/ });
				}
				const isModifier = mode === 'modifiers' ? getBlacklistedKeysValue('modifier', el.value) : false;
				if (isModifier) {
					const replacementModifier = bonusReplacements(isModifier, evaluationData, false, effect);
					modifier = _ac5eSafeEval({ expression: replacementModifier, sandbox: evaluationData /*canBeStatic: true*/ });
				}
				const isThreshold = hook === 'attack' ? getBlacklistedKeysValue('threshold', el.value) : false;
				if (isThreshold) {
					const replacementThreshold = bonusReplacements(isThreshold, evaluationData, false, effect);
					threshold = _ac5eSafeEval({ expression: replacementThreshold, sandbox: evaluationData /*canBeStatic: true*/ });
				}
				let valuesToEvaluate = el.value
					.split(';')
					.map((v) => v.trim())
					.filter((v) => {
						if (!v) return false;
						const [key] = v.split(/[:=]/).map((s) => s.trim());
						return !blacklist.includes(key);
					})
					.join(';');
				if (!valuesToEvaluate) valuesToEvaluate = 'true';
				if (valuesToEvaluate.includes('effectOriginTokenId')) valuesToEvaluate = valuesToEvaluate.replaceAll('effectOriginTokenId', `"${_getEffectOriginToken(effect, 'id')}"`);
				validFlags[effect.id] = {
					name: effect.name,
					actorType,
					mode,
					bonus,
					modifier,
					threshold,
					evaluation: getMode({ value: valuesToEvaluate }),
				};
			})
	);
	if (opponent) {
		opponent.appliedEffects.filter((effect) =>
			effect.changes
				.filter((change) => effectChangesTest({ token: opponentToken, change, actorType: 'opponent', hook, effect, effectDeletions, effectUpdates, evaluationData }))
				.forEach((el) => {
					const { actorType, mode } = getActorAndModeType(el, false);
					if (!actorType || !mode) return;
					let bonus, modifier, threshold;
					let isBonus = mode === 'bonus' ? getBlacklistedKeysValue('bonus', el.value) : false;
					if (isBonus) {
						const replacementBonus = bonusReplacements(isBonus, evaluationData, false, effect);
						if (isLiteralOrDiceExpression(replacementBonus)) bonus = replacementBonus.trim();
						else bonus = _ac5eSafeEval({ expression: replacementBonus, sandbox: evaluationData /*canBeStatic: true*/ });
					}
					const isModifier = mode === 'modifiers' ? getBlacklistedKeysValue('modifier', el.value) : false;
					if (isModifier) {
						const replacementModifier = bonusReplacements(isModifier, evaluationData, false, effect);
						modifier = _ac5eSafeEval({ expression: replacementModifier, sandbox: evaluationData /*canBeStatic: true*/ });
					}
					const isThreshold = hook === 'attack' ? getBlacklistedKeysValue('threshold', el.value) : false;
					if (isThreshold) {
						const replacementThreshold = bonusReplacements(isThreshold, evaluationData, false, effect);
						threshold = _ac5eSafeEval({ expression: replacementThreshold, sandbox: evaluationData /*canBeStatic: true*/ });
					}
					let valuesToEvaluate = el.value
						.split(';')
						.map((v) => v.trim())
						.filter((v) => {
							if (!v) return false;
							const [key] = v.split(/[:=]/).map((s) => s.trim());
							return !blacklist.includes(key);
						})
						.join(';');
					if (!valuesToEvaluate) valuesToEvaluate = 'true';
					if (valuesToEvaluate.includes('effectOriginTokenId')) valuesToEvaluate = valuesToEvaluate.replaceAll('effectOriginTokenId', `"${_getEffectOriginToken(effect, 'id')}"`);
					validFlags[effect.id] = {
						name: effect.name,
						actorType,
						mode,
						bonus,
						modifier,
						threshold,
						evaluation: getMode({ value: valuesToEvaluate }),
					};
				})
		);
	}
	if (foundry.utils.isEmpty(validFlags)) return ac5eConfig;
	const validFlagsEffectUpdates = [];
	for (const el in validFlags) {
		let { actorType, evaluation, mode, name, bonus, modifier, threshold, isAura } = validFlags[el];
		if (mode.includes('skill') || mode.includes('tool')) mode = 'check';
		if (evaluation) {
			const hasEffectUpdate = effectUpdates.find((u) => u.name === name);
			if (hasEffectUpdate) validFlagsEffectUpdates.push(hasEffectUpdate.updates);
			if (!isAura) ac5eConfig[actorType][mode].push(name); //there can be active effects named the same so validFlags.name would disregard any other that the first
			else ac5eConfig[actorType][mode].push(el); //the auras have already the token name in the el passed, so is not an issue
			if (bonus) ac5eConfig.parts = ac5eConfig.parts.concat(bonus);
			if (modifier) {
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
			if (threshold) ac5eConfig.threshold = ac5eConfig.threshold.concat(threshold);
		}
	}
	subject.deleteEmbeddedDocuments('ActiveEffect', effectDeletions);
	subject.updateEmbeddedDocuments('ActiveEffect', validFlagsEffectUpdates);
	return ac5eConfig;

	//special functions\\
	function getMode({ value, auraTokenEvaluationData }) {
		if (['1', 'true'].includes(value)) return true;
		if (['0', 'false'].includes(value)) return false;
		const clauses = value
			.split(';')
			.map((v) => v.trim())
			.filter(Boolean);
		if (settings.debug) console.log('AC5E._getMode:', { clauses });

		return clauses.some((clause) => {
			let mult = null;
			if (clause.startsWith('!')) {
				clause = clause.slice(1).trim();
				mult = '!';
			}
			const sandbox = auraTokenEvaluationData ? auraTokenEvaluationData : evaluationData;
			return mult ? !_ac5eSafeEval({ expression: clause, sandbox }) : _ac5eSafeEval({ expression: clause, sandbox });
		});
	}
}

function handleUses({ actorType, change, effect, effectDeletions, effectUpdates }) {
	if (actorType !== 'subject') return true;
	const values = change.value.split(';');
	const hasCount = getBlacklistedKeysValue('usesCount', change.value);
	const isOnce = values.find((use) => use.includes('once'));
	if (!hasCount && !isOnce) {
		return true;
	}
	const isTransfer = effect.transfer; // && actorType === 'subject';
	if (isOnce && !isTransfer) {
		effectDeletions.push(effect.id);
	} else if (isOnce && isTransfer) {
		effect.update({ disabled: true });
	} else if (hasCount && actorType === 'subject') {
		const isNumber = parseInt(hasCount, 10);
		const isUuid = foundry.utils.parseUuid(hasCount);

		if (!isNaN(isNumber)) {
			if (isNumber === 0) {
				return false;
			}
			const newUses = isNumber - 1;

			if (newUses === 0 && !isTransfer) {
				effectDeletions.push(effect.id);
			} else {
				let changes = foundry.utils.duplicate(effect.changes);
				const index = changes.findIndex((c) => c.key === change.key);

				if (index >= 0) {
					changes[index].value = changes[index].value.replace(/usesCount\s*[:=]\s*\d+/, `usesCount=${newUses}`);

					if (!isTransfer) {
						effectUpdates.push({ name: effect.name, updates: { _id: effect.id, changes }, documentType: 'ActiveEffect' });
					} else {
						const hasInitialUsesFlag = effect.getFlag('automated-conditions-5e', 'initialUses')?.[effect.id]?.initialUses;
						if (newUses === 0) {
							if (!hasInitialUsesFlag) effect.update({ disabled: true });
							else {
								changes[index].value = changes[index].value.replace(/usesCount\s*[:=]\s*\d+/, `usesCount=${hasInitialUsesFlag}`);
								effect.update({ changes, disabled: true });
							}
						} else {
							if (!hasInitialUsesFlag) effect.update({ changes, 'flags.automated-conditions-5e': { initialUses: { [effect.id]: { initialUses: isNumber } } } });
							else effect.update({ changes });
						}
					}
				}
			}
		}
	}
	return true;
}

function getBlacklistedKeysValue(key, values) {
	const regex = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.+)$`);
	const parts = values
		.split(';')
		.map((e) => e.trim())
		.map((e) => regex.exec(e))
		.find(Boolean);
	return parts ? parts[1].trim() : '';
}

function isLiteralOrDiceExpression(expression) {
	const trimmed = expression.trim();

	// Allow: numbers, dice terms, + - * / ( ), optional damage tags
	// Block: anything with variable names, @, game, canvas, etc
	const diceLikePattern = /^[\d+\-*/().\s\[\]d]+$/i;

	// Sanitize: if it contains any letters **not** part of a [tag], it's unsafe
	const hasUnsafeLetters = /[a-zA-Z]/.test(
		trimmed
			.replace(/\[\w+]/g, '') // ignore damageType brackets like [fire]
			.replace(/d\d+/g, '') // ignore dice like d6, d12
	);

	return diceLikePattern.test(trimmed) || !hasUnsafeLetters;
}
