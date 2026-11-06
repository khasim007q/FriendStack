export const CATALOG = [
  ["bold", "Bold", "Flame", "damage"],
  ["loyal", "Loyal", "Shield", "shield"],
  ["caring", "Caring", "Heart", "heal"],
  ["playful", "Playful", "Sparkles", "draw"],
  ["social", "Social", "Users", "mana"],
  ["calm", "Calm", "Moon", "shield"],
  ["sensitive", "Sensitive", "Feather", "heal"],
  ["competitive", "Competitive", "Swords", "attack"],
  ["impulsive", "Impulsive", "Zap", "damage"],
  ["tidy", "Tidy", "Diamond", "guard"],
  ["messy", "Messy", "Wind", "damage"],
  ["disciplined", "Disciplined", "Target", "attack"],
].map(([id, name, icon, effect], index) => ({ id, name, icon, effect, index }));
export const TRIGGERS = {
  active: "When I activate it",
  enter: "When entering play",
  turn: "At my turn’s start",
  attack: "After attacking",
  hurt: "After taking damage",
  ally_defeated: "When an ally is defeated",
};
export const EFFECTS = {
  damage: { name: "Deal damage", weight: 1 },
  heal: { name: "Restore health", weight: 1 },
  shield: { name: "Give shielding", weight: 1 },
  draw: { name: "Draw cards", weight: 2 },
  mana: { name: "Gain mana", weight: 1 },
  attack: { name: "Boost attack for this turn", weight: 2 },
  guard: { name: "Guard until next turn", weight: 2 },
};
export const TARGETS = {
  self: "This friend",
  ally: "An allied friend",
  enemy: "An enemy friend",
  player: "Your player",
  opponent: "Opponent player",
};
export const RULES = {
  health: 30,
  matchMs: 480000,
  turnMs: 30000,
  reconnectMs: 30000,
  slots: 3,
  maxMana: 10,
  normalCost: 3,
  superiorCost: 8,
  upgradeCost: 5,
  activeCost: 2,
};
export function defaultAbility(type) {
  const trait = CATALOG.find((t) => t.id === type) || CATALOG[0];
  const effect = trait.effect;
  return {
    trigger: "active",
    target:
      effect === "damage"
        ? "enemy"
        : ["heal", "draw", "mana"].includes(effect)
          ? "player"
          : "self",
    effect,
    amount: ["guard", "draw", "attack"].includes(effect) ? 1 : 2,
  };
}
export function validateAbility(input) {
  if (!input || typeof input !== "object")
    throw new Error("Design an ability first.");
  const { trigger, target, effect, amount } = input;
  if (!TRIGGERS[trigger] || !TARGETS[target] || !EFFECTS[effect])
    throw new Error("Choose a valid trigger, target, and effect.");
  const budget = trigger === "active" ? 3 : 2;
  if (
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount * EFFECTS[effect].weight > budget
  )
    throw new Error(`This ability has a ${budget}-point budget.`);
  const allowed =
    effect === "damage"
      ? ["enemy", "opponent", "self"]
      : ["heal", "shield"].includes(effect)
        ? ["self", "ally", "player"]
        : ["draw", "mana"].includes(effect)
          ? ["player"]
          : ["self", "ally"];
  if (!allowed.includes(target))
    throw new Error("That effect cannot use the selected target.");
  return { trigger, target, effect, amount };
}
export function describeAbility(a, superior = false) {
  const amount =
    a.amount +
    (superior && ["damage", "heal", "shield"].includes(a.effect) ? 1 : 0);
  const descriptions = {
    damage: `Deal ${amount} damage`,
    heal: `Restore ${amount} health`,
    shield: `Give ${amount} shield`,
    draw: `Draw ${amount} card${amount === 1 ? "" : "s"}`,
    mana: `Gain ${amount} mana`,
    attack: `Give +${amount} attack this turn`,
    guard: "Guard until your next turn",
  };
  return `${descriptions[a.effect]}${["draw", "mana"].includes(a.effect) ? "" : ` · ${TARGETS[a.target]?.toLowerCase()}`}`;
}
export const SAMPLE_FRIENDS = [
  {
    id: "sample-maya",
    name: "Maya Chen",
    handle: "THE RIDE OR DIE",
    color: "lavender",
    face: 0,
    quote: "Always in your corner. Occasionally in your business.",
    types: ["loyal", "caring", "bold"],
  },
  {
    id: "sample-rio",
    name: "Rio Santos",
    handle: "THE WILD CARD",
    color: "peach",
    face: 1,
    quote: "Has a plan. Changes it halfway through.",
    types: ["playful", "impulsive", "social"],
  },
  {
    id: "sample-noor",
    name: "Noor Patel",
    handle: "THE QUIET STORM",
    color: "mint",
    face: 2,
    quote: "Says very little. Somehow wins the argument.",
    types: ["calm", "disciplined", "competitive"],
  },
];
