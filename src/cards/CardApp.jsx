import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Diamond,
  Eye,
  Flame,
  Gamepad2,
  Heart,
  History,
  Layers3,
  Link,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Timer,
  Users,
  Wifi,
  X,
  Zap,
  BookOpen,
  Settings2,
  Flag,
  CheckCircle2,
  Mail,
  Target,
  RefreshCw,
} from "lucide-react";
import {
  CATALOG,
  EFFECTS,
  TRIGGERS,
  TARGETS,
  SAMPLE_FRIENDS,
  defaultAbility,
  describeAbility,
} from "../../shared/cards.mjs";
import { useCards } from "./useCards";
import Portrait from "./Portrait";
import "./cards.css";

const formatTime = (ms) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(Math.max(0, ms) / 1000) % 60 < 10 ? "0" : ""}${Math.floor(Math.max(0, ms) / 1000) % 60}`;
const iconFor = (effect) =>
  ({
    damage: Flame,
    heal: Heart,
    shield: Shield,
    draw: Layers3,
    mana: Diamond,
    attack: Swords,
    guard: ShieldCheck,
  })[effect] || Sparkles;
function Icon({ effect, size = 15, ...props }) {
  const Component = iconFor(effect);
  return <Component size={size} {...props} />;
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement,
      el = ref.current;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      close.current();
    };
    el.addEventListener("cancel", cancel);
    return () => {
      el.removeEventListener("cancel", cancel);
      el.close();
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`card-modal ${wide ? "wide" : ""}`}
      aria-labelledby="card-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <span className="fs-kicker">FRIENDSTACK / YOUR INNER CIRCLE</span>
          <h2 id="card-modal-title">{title}</h2>
        </div>
        <button className="fs-icon" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function FriendCard({
  card,
  compact = false,
  onClick,
  selected = false,
  battle = false,
  children,
}) {
  const isSuperior = Boolean(card.superior && card.maxHealth);
  const color = card.color || "lavender";
  return (
    <div
      className={`collectible ${color} ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${battle ? "battle-unit" : ""} ${isSuperior ? "is-superior" : ""}`}
    >
      <button
        className="collectible-main"
        onClick={onClick}
        disabled={!onClick}
        aria-label={`${isSuperior ? "Superior " : ""}${card.name}${battle ? `, ${card.health} health, ${card.attack + (card.attackBonus || 0)} attack` : ""}`}
      >
        <div className="collectible-top">
          <span className="mana-gem">
            <Diamond size={27} fill="currentColor" />
            <b>{isSuperior ? 8 : card.cost || 3}</b>
          </span>
          <span>{isSuperior ? "SUPERIOR FRIEND" : "FRIEND CARD"}</span>
          <Sparkles size={13} />
        </div>
        <div className="portrait-holder">
          <Portrait face={card.face} color={color} />
          {card.guard && (
            <span className="card-guard">
              <ShieldCheck size={15} />
              GUARD
            </span>
          )}
          {card.shield > 0 && (
            <span className="card-shield">
              <Shield size={12} />
              {card.shield}
            </span>
          )}
        </div>
        <div className="collectible-body">
          <span className="character-label">
            {card.sample
              ? "FICTIONAL STARTER"
              : isSuperior
                ? "A DIFFERENT SIDE OF THEM"
                : "SOMEONE YOU KNOW"}
          </span>
          <h3>{card.name}</h3>
          <div className="card-trait-tags">
            {card.abilities?.length ? (
              card.abilities.slice(0, compact ? 2 : 3).map((a) => (
                <span key={a.type}>
                  <Icon effect={a.ability.effect} size={10} />
                  {a.name}
                </span>
              ))
            ) : (
              <span>
                <Sparkles size={10} />A story waiting to happen
              </span>
            )}
          </div>
        </div>
        <div className="collectible-stats">
          <span>
            <Swords size={15} />
            <b>{card.attack + (card.attackBonus || 0) || 2}</b>
            <small>ATTACK</small>
          </span>
          <span className="card-rarity">{isSuperior ? "✦ ✦ ✦" : "✦"}</span>
          <span>
            <Heart size={15} />
            <b>{card.health ?? 5}</b>
            <small>HEALTH</small>
          </span>
        </div>
      </button>
      {children}
    </div>
  );
}

function AuthForm({ client, mode, setMode, onDone }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      await client.signIn(mode, values);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="fs-modal-copy">
        Your people, your cards, your stories. Create a saved identity to make
        them yours.
      </p>
      <div className="fs-switch">
        <button
          onClick={() => setMode("register")}
          aria-pressed={mode === "register"}
        >
          Create identity
        </button>
        <button
          onClick={() => setMode("login")}
          aria-pressed={mode === "login"}
        >
          Sign in
        </button>
      </div>
      <form onSubmit={submit} className="fs-form">
        {mode === "register" && (
          <label>
            Your name
            <input
              name="name"
              autoComplete="name"
              maxLength={30}
              required
              placeholder="What your friends call you"
            />
          </label>
        )}
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            pattern="[A-Za-z0-9_]{3,24}"
            required
            minLength={3}
            maxLength={24}
            placeholder="e.g. sundaystrategist"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            minLength={8}
            maxLength={128}
            required
            placeholder="At least 8 characters"
          />
        </label>
        {error && (
          <p className="fs-error" role="alert">
            {error}
          </p>
        )}
        <button className="fs-primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="fs-spin" size={17} />
          ) : mode === "register" ? (
            "Make it yours"
          ) : (
            "Welcome back"
          )}
          <ArrowRight size={17} />
        </button>
        <p className="fs-private">
          <LockKeyhole size={12} />
          Saved with your identity. No email required.
        </p>
      </form>
    </>
  );
}

function TraitForm({ person, existing, client, onDone }) {
  const first =
    existing || person.traits.find((t) => t.authorId === client.data.user.id);
  const [type, setType] = useState(first?.type || "bold");
  const revision = first?.revisions.find((r) =>
    ["approved", "pending"].includes(r.status),
  );
  const [name, setName] = useState(revision?.name || ""),
    [description, setDescription] = useState(revision?.description || ""),
    [ability, setAbility] = useState(revision?.ability || defaultAbility(type)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function chooseType(value) {
    setType(value);
    const t = person.traits.find(
        (t) => t.authorId === client.data.user.id && t.type === value,
      ),
      r = t?.revisions.find((r) => ["approved", "pending"].includes(r.status));
    setName(r?.name || "");
    setDescription(r?.description || "");
    setAbility(r?.ability || defaultAbility(value));
  }
  const targets =
    ability.effect === "damage"
      ? ["enemy", "opponent", "self"]
      : ["heal", "shield"].includes(ability.effect)
        ? ["self", "ally", "player"]
        : ["draw", "mana"].includes(ability.effect)
          ? ["player"]
          : ["self", "ally"];
  const budget = ability.trigger === "active" ? 3 : 2,
    max = Math.max(1, Math.floor(budget / EFFECTS[ability.effect].weight));
  function change(patch) {
    let next = { ...ability, ...patch };
    const choices =
      next.effect === "damage"
        ? ["enemy", "opponent", "self"]
        : ["heal", "shield"].includes(next.effect)
          ? ["self", "ally", "player"]
          : ["draw", "mana"].includes(next.effect)
            ? ["player"]
            : ["self", "ally"];
    if (!choices.includes(next.target)) next.target = choices[0];
    next.amount = Math.min(
      next.amount,
      Math.floor(
        (next.trigger === "active" ? 3 : 2) / EFFECTS[next.effect].weight,
      ),
    );
    setAbility(next);
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await client.api(`/friends/${person.id}/traits`, {
        type,
        name,
        description,
        ability,
      });
      await client.refresh();
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="fs-form" onSubmit={submit}>
      <p className="fs-modal-copy">
        Your version of <strong>{person.name}</strong>. A fixed trait type, a
        story only you know, and a power you design.
      </p>
      <label>
        Trait type
        <select
          aria-label="Trait type"
          value={type}
          onChange={(e) => chooseType(e.target.value)}
        >
          {CATALOG.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {person.traits.some((p) => p.type === t.id)
                ? " · discovered"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Give this trait a personal name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
          placeholder="e.g. The midnight rescue crew"
        />
      </label>
      <label>
        Your private description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={600}
          rows={3}
          required
          placeholder="What makes this person this way around you?"
        />
      </label>
      <p className="fs-private align-left">
        <Eye size={13} />
        Only you and {person.name} can read this description.
      </p>
      <div className="ability-builder">
        <div className="ability-title">
          <Zap size={17} />
          <strong>Make it a power</strong>
          <span>
            {ability.amount * EFFECTS[ability.effect].weight}/{budget} POINTS
          </span>
        </div>
        <div className="form-grid">
          <label>
            When
            <select
              aria-label="Ability trigger"
              value={ability.trigger}
              onChange={(e) => change({ trigger: e.target.value })}
            >
              {Object.entries(TRIGGERS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Effect
            <select
              aria-label="Ability effect"
              value={ability.effect}
              onChange={(e) => change({ effect: e.target.value })}
            >
              {Object.entries(EFFECTS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target
            <select
              aria-label="Ability target"
              value={ability.target}
              onChange={(e) => change({ target: e.target.value })}
            >
              {targets.map((k) => (
                <option key={k} value={k}>
                  {TARGETS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Strength
            <select
              aria-label="Ability strength"
              value={ability.amount}
              onChange={(e) => change({ amount: Number(e.target.value) })}
            >
              {Array.from({ length: max }, (_, i) => (
                <option value={i + 1} key={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ability-preview">
          <Icon effect={ability.effect} size={20} />
          <div>
            <strong>{name || "Your new ability"}</strong>
            <p>
              {TRIGGERS[ability.trigger]}: {describeAbility(ability)}
            </p>
            <small>
              {ability.trigger === "active"
                ? "2 mana · Uses this friend’s action"
                : "Automatic · Shares the once-per-round ability limit"}
            </small>
          </div>
        </div>
      </div>
      <div className="fs-notice">
        <ShieldCheck size={17} />
        <p>
          {person.sample
            ? "This is a fictional starter. Sample traits are approved automatically for testing."
            : `${person.name} must claim their profile and approve this revision before multiplayer. Their previous approved version stays playable meanwhile. You can test drafts against the bot.`}
        </p>
      </div>
      {error && (
        <p className="fs-error" role="alert">
          {error}
        </p>
      )}
      <button className="fs-primary" disabled={busy}>
        {busy ? (
          <LoaderCircle className="fs-spin" size={17} />
        ) : person.sample ? (
          "Save sample trait"
        ) : (
          "Send for approval"
        )}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}

function CardDetails({ person, user, onTrait, onInvite }) {
  const [tab, setTab] = useState("card");
  return (
    <>
      <div className="profile-preview">
        <FriendCard card={person.card} compact />
        <div>
          <span className="fs-kicker">
            {person.isYou
              ? "YOUR CHARACTER"
              : person.sample
                ? "FICTIONAL STARTER"
                : "YOUR PERSONAL VERSION"}
          </span>
          <h3>{person.name}</h3>
          <p>{person.card.approvedCount}/12 personal traits approved</p>
          <div className="discovery-dots">
            {CATALOG.map((t) => (
              <span
                key={t.id}
                title={t.name}
                className={
                  person.card.abilities.some(
                    (a) => a.type === t.id && a.source === "personal",
                  )
                    ? "discovered"
                    : ""
                }
              />
            ))}
          </div>
          <p>
            {person.card.superior ? (
              <>
                <Crown size={14} />
                Superior variant unlocked
              </>
            ) : (
              "Discover three approved personal traits to unlock their superior self."
            )}
          </p>
          {!person.isYou && (
            <button className="fs-primary small" onClick={() => onTrait()}>
              <Plus size={15} />
              Describe a trait
            </button>
          )}
          {!person.claimed && !person.sample && (
            <button className="fs-secondary small" onClick={onInvite}>
              <Link size={14} />
              Invite to claim profile
            </button>
          )}
        </div>
      </div>
      <div className="fs-tabs modal-tabs">
        <button aria-pressed={tab === "card"} onClick={() => setTab("card")}>
          Powers & consensus
        </button>
        <button
          aria-pressed={tab === "history"}
          onClick={() => setTab("history")}
        >
          Relationship history
        </button>
      </div>
      {tab === "card" ? (
        <div className="profile-powers">
          {person.card.abilities.length ? (
            person.card.abilities.map((a) => (
              <div className="power-row" key={a.type}>
                <span className={`effect-icon ${a.ability.effect}`}>
                  <Icon effect={a.ability.effect} size={18} />
                </span>
                <div>
                  <strong>{a.name}</strong>
                  <p>{describeAbility(a.ability)}</p>
                  <small>
                    {TRIGGERS[a.ability.trigger]} ·{" "}
                    {a.source === "shared"
                      ? "Shared base power"
                      : "Your personal power"}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <div className="fs-empty">
              <Sparkles size={24} />
              <h3>A blank canvas, a familiar face.</h3>
              <p>Their powers will grow with approved descriptions.</p>
            </div>
          )}
          <div className="consensus">
            <span className="fs-kicker">SHARED REPUTATION</span>
            <p>
              The two most-endorsed approved types shape the shared base.
              Personal powers make your version different.
            </p>
            <div>
              {person.card.endorsements.map((e) => (
                <span key={e.id}>
                  {e.name}
                  <b>{e.count}</b>
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="trait-history">
          {person.traits.length ? (
            person.traits.map((t) => (
              <section key={t.id}>
                <h4>
                  {CATALOG.find((c) => c.id === t.type)?.name}
                  <span>{t.authorId === user.id ? "You" : t.authorName}</span>
                </h4>
                {t.revisions.map((r, index) => (
                  <details key={r.id} open={index === 0}>
                    <summary>
                      <strong>{r.name}</strong>
                      <span className={`state-badge ${r.status}`}>
                        {r.status}
                      </span>
                      <ChevronDown size={13} />
                    </summary>
                    <p className="private-description">
                      <LockKeyhole size={12} />
                      {r.description}
                    </p>
                    <p>
                      {describeAbility(r.ability)} ·{" "}
                      {TRIGGERS[r.ability.trigger]}
                    </p>
                    <small>{new Date(r.created).toLocaleString()}</small>
                    {t.authorId === user.id && (
                      <button className="fs-text" onClick={() => onTrait(t)}>
                        Develop this trait
                        <ArrowUpRight size={12} />
                      </button>
                    )}
                  </details>
                ))}
              </section>
            ))
          ) : (
            <p className="fs-modal-copy">
              Your story with this friend starts with the first description.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function DeckBuilder({ data, client, onSaved, onInspect }) {
  const [selected, setSelected] = useState(data.decks[0]?.id || ""),
    [draft, setDraft] = useState(() =>
      structuredClone(
        data.decks[0] || { name: "My friend deck", cards: [], reserve: null },
      ),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const people = data.people,
    friends = draft.cards.filter((c) => c.kind === "friend"),
    powers = draft.cards.filter((c) => c.kind === "power");
  function choose(value) {
    setSelected(value);
    setDraft(
      structuredClone(
        data.decks.find((d) => d.id === value) || {
          name: "My friend deck",
          cards: [],
          reserve: null,
        },
      ),
    );
    setError("");
  }
  function add(person) {
    if (
      friends.length >= 6 ||
      friends.filter((c) => c.personId === person.id).length >= 2
    )
      return;
    setDraft({
      ...draft,
      cards: [...draft.cards, { kind: "friend", personId: person.id }],
    });
  }
  function remove(index) {
    setDraft({ ...draft, cards: draft.cards.filter((_, i) => i !== index) });
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await client.api("/decks", { ...draft, id: selected || undefined });
      await client.refresh();
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="deck-builder">
      <div className="section-heading">
        <div>
          <span className="fs-kicker">GOOD COMPANY. GREAT COMBINATIONS.</span>
          <h1>
            Build your inner circle<span>.</span>
          </h1>
          <p>
            Six friends. Six linked power-ups. One person you can really count
            on.
          </p>
        </div>
        <label className="deck-select">
          Saved deck
          <select
            aria-label="Saved deck"
            value={selected}
            onChange={(e) => choose(e.target.value)}
          >
            {data.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="">+ Create a new deck</option>
          </select>
        </label>
      </div>
      <div className="deck-layout">
        <div>
          <div className="fs-subheading">
            <h3>Your friend pool</h3>
            <span>{friends.length}/6 FRIEND CARDS</span>
          </div>
          <div className="deck-pool">
            {people.map((p) => {
              const count = friends.filter((c) => c.personId === p.id).length;
              return (
                <div key={p.id}>
                  <FriendCard
                    card={p.card}
                    compact
                    onClick={() => onInspect(p)}
                  />
                  <button
                    className="add-to-deck"
                    disabled={friends.length >= 6 || count >= 2}
                    onClick={() => add(p)}
                  >
                    {count >= 2 ? (
                      <>
                        <Check size={14} />
                        Two copies added
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        Add friend<span>{count}/2</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <aside className="deck-list">
          <label className="fs-field">
            Deck name
            <input
              value={draft.name}
              maxLength={36}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="deck-progress">
            <span
              style={{
                width: `${Math.min(100, (draft.cards.length / 12) * 100)}%`,
              }}
            />
          </div>
          <div className="fs-subheading">
            <h3>The squad</h3>
            <span>{friends.length}/6</span>
          </div>
          {draft.cards.map((c, i) => {
            const p = data.people.find((p) => p.id === c.personId);
            if (c.kind !== "friend") return null;
            return (
              <div className="deck-item" key={i}>
                <span className={`mini-avatar ${p?.color}`}>
                  {p?.name.slice(0, 1)}
                </span>
                <span>{p?.name || "Missing friend"}</span>
                <small>3</small>
                <button
                  aria-label={`Remove ${p?.name} copy`}
                  onClick={() => remove(i)}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          <div className="fs-subheading">
            <h3>Linked power-ups</h3>
            <span>{powers.length}/6</span>
          </div>
          {draft.cards.map((c, i) => {
            if (c.kind !== "power") return null;
            const p = data.people.find((p) => p.id === c.personId);
            return (
              <div className="deck-item power-item" key={i}>
                <Icon effect={c.effect} />
                <span>
                  {p?.name.split(" ")[0]}’s {c.effect}
                </span>
                <button
                  aria-label={`Remove ${c.effect} power-up`}
                  onClick={() => remove(i)}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          <PowerAdder
            people={people.filter((p) =>
              friends.some((c) => c.personId === p.id),
            )}
            disabled={powers.length >= 6}
            onAdd={(c) => setDraft({ ...draft, cards: [...draft.cards, c] })}
          />
          <div className="reserve-picker">
            <label>
              Superior reserve
              <Crown size={14} />
            </label>
            <select
              value={draft.reserve || ""}
              aria-label="Superior reserve"
              onChange={(e) =>
                setDraft({ ...draft, reserve: e.target.value || null })
              }
            >
              <option value="">No reserve selected</option>
              {people
                .filter((p) => p.card.superior)
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} · Superior
                  </option>
                ))}
            </select>
            <p>
              Three approved personal traits unlock a superior. Summon for 8
              mana or upgrade for 5.
            </p>
          </div>
          {error && (
            <p className="fs-error" role="alert">
              {error}
            </p>
          )}
          <button className="fs-primary" disabled={saving} onClick={save}>
            {saving ? (
              <LoaderCircle size={16} className="fs-spin" />
            ) : (
              <Check size={16} />
            )}
            Save deck
            <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </section>
  );
}
function PowerAdder({ people, disabled, onAdd }) {
  const [person, setPerson] = useState(""),
    [effect, setEffect] = useState("shield");
  const current = people.some((p) => p.id === person) ? person : people[0]?.id;
  return (
    <div className="power-adder">
      <select
        aria-label="Power-up friend"
        value={current || ""}
        onChange={(e) => setPerson(e.target.value)}
      >
        <option value="" disabled>
          Choose friend
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Power-up effect"
        value={effect}
        onChange={(e) => setEffect(e.target.value)}
      >
        {["heal", "shield", "attack", "guard"].map((e) => (
          <option value={e} key={e}>
            {e}
          </option>
        ))}
      </select>
      <button
        aria-label="Add linked power-up"
        disabled={disabled || !current}
        onClick={() => onAdd({ kind: "power", personId: current, effect })}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}

function Battle({ client, onInspect }) {
  const { room, data, send, status, offset } = client,
    [selection, setSelection] = useState(null),
    [now, setNow] = useState(Date.now()),
    [showLog, setShowLog] = useState(false),
    [confirmLeave, setConfirmLeave] = useState(false);
  const me = room.seats.find((s) => s.id === data.user.id),
    opponent = room.seats.find((s) => s.id !== data.user.id),
    myTurn = room.currentPlayerId === me.id,
    actions = room.legalActions || [],
    finished = room.phase === "finished";
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 200);
    return () => clearInterval(id);
  }, [offset]);
  useEffect(() => {
    setSelection(null);
    for (const menu of document.querySelectorAll(
      ".unit-commands details[open]",
    ))
      menu.open = false;
  }, [room.turnNumber, room.phase]);
  useEffect(() => {
    if (selection && window.innerWidth < 741)
      document.querySelector(".battle-table")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
  }, [selection]);
  const relevant = selection
    ? actions.filter((a) =>
        selection.kind === "card"
          ? a.cardId === selection.id
          : selection.kind === "attack"
            ? a.type === "attack" && a.unitId === selection.id
            : selection.kind === "ability"
              ? a.type === "ability" &&
                a.unitId === selection.id &&
                a.abilityIndex === selection.index
              : selection.kind === "reserve"
                ? ["superior", "upgrade"].includes(a.type)
                : false,
      )
    : [];
  const targetIds = new Set(
    relevant.map((a) => a.targetId || a.unitId).filter(Boolean),
  );
  function act(a) {
    if (!a) return;
    if (send({ type: "act", actionId: a.id })) setSelection(null);
  }
  function target(id) {
    const a = relevant.find(
      (a) => a.targetId === id || (a.type === "upgrade" && a.unitId === id),
    );
    if (a) act(a);
  }
  function chooseCard(card) {
    const available = actions.filter((a) => a.cardId === card.id);
    if (!available.length) return;
    if (card.kind === "friend") act(available[0]);
    else
      setSelection({
        kind: "card",
        id: card.id,
        name: `${card.name}’s ${card.effect}`,
      });
  }
  function selectReserve() {
    const available = actions.filter((a) =>
      ["superior", "upgrade"].includes(a.type),
    );
    if (available.length)
      setSelection({
        kind: "reserve",
        id: "reserve",
        name: "Superior reserve",
      });
  }
  const seats = [opponent, me];
  return (
    <section className="duel-shell">
      <div className="duel-topline">
        <button className="fs-text" onClick={() => setConfirmLeave(true)}>
          <ArrowLeft size={15} />
          Leave table
        </button>
        <div>
          <span className="fs-live-dot" />
          {room.phase === "lobby"
            ? "PRIVATE TABLE"
            : finished
              ? "FINAL RESULT"
              : myTurn
                ? "YOUR TURN"
                : "OPPONENT’S TURN"}
          <span className="duel-room-code">{room.code}</span>
        </div>
        <button className="fs-text" onClick={() => setShowLog(!showLog)}>
          <History size={15} />
          Battle log
        </button>
      </div>
      {room.phase === "lobby" ? (
        <div className="table-lobby">
          <div className="table-lobby-icon">
            <Swords size={35} />
          </div>
          <span className="fs-kicker">
            A LITTLE COMPETITION BETWEEN FRIENDS
          </span>
          <h1>A seat at your table.</h1>
          <p>
            Share this room code. Your friend joins with their own saved deck.
          </p>
          <button
            className="room-code-large"
            onClick={() => navigator.clipboard?.writeText(room.code)}
            aria-label={`Copy card room code ${room.code}`}
          >
            {room.code}
            <Copy size={20} />
          </button>
          <div className="lobby-seats">
            {room.seats.map((s) => (
              <div key={s.id}>
                <span className="lobby-avatar">
                  {s.name.slice(0, 2).toUpperCase()}
                </span>
                <strong>{s.name}</strong>
                <span>
                  {s.ready ? (
                    <>
                      <Check size={14} />
                      Ready
                    </>
                  ) : (
                    "Choosing their moment"
                  )}
                </span>
              </div>
            ))}
            {room.seats.length < 2 && (
              <div className="empty-seat">
                <Users size={26} />
                <strong>A friend belongs here.</strong>
                <span>Waiting for player two</span>
              </div>
            )}
          </div>
          <button
            className={`fs-secondary ${me.ready ? "is-ready" : ""}`}
            onClick={() => send({ type: "ready", ready: !me.ready })}
          >
            {me.ready ? <Check size={16} /> : <Flag size={16} />}{" "}
            {me.ready ? "You’re ready · Undo" : "I’m ready"}
          </button>
          {room.hostId === me.id && (
            <button
              className="fs-primary"
              disabled={
                room.seats.length !== 2 ||
                room.seats.some((s) => !s.ready || !s.connected)
              }
              onClick={() => send({ type: "start" })}
            >
              Start the duel
              <ArrowRight size={17} />
            </button>
          )}
          <p className="fs-private">
            <LockKeyhole size={12} />
            Only your friend’s public cards will be visible during play.
          </p>
        </div>
      ) : (
        <>
          <div className="battle-table">
            <div className="table-texture" />
            {seats.map(
              (s, index) =>
                s && (
                  <div
                    className={`battle-side ${index === 0 ? "opponent-side" : "own-side"}`}
                    key={s.id}
                  >
                    <div
                      className={`player-status ${targetIds.has(s.id) ? "targetable" : ""}`}
                    >
                      <button
                        onClick={() => target(s.id)}
                        disabled={!targetIds.has(s.id)}
                        aria-label={`Target ${s.name}`}
                      >
                        <span
                          className={`player-orb ${index === 0 ? "enemy" : ""}`}
                        >
                          {s.bot ? (
                            <Gamepad2 size={20} />
                          ) : (
                            s.name.slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <span>
                          <strong>
                            {s.name}
                            {index === 1 && <small>YOU</small>}
                          </strong>
                          <span className="player-meta">
                            {!s.connected
                              ? "Reconnecting · 30s grace"
                              : index === 0
                                ? `${s.handCount} cards in hand · ${s.deckCount} in deck`
                                : `${s.deckCount} cards in deck · ${s.fatigue ? `Fatigue ${s.fatigue}` : "Make your move"}`}
                          </span>
                        </span>
                        <span className="player-health">
                          <Heart size={15} fill="currentColor" />
                          {Math.max(0, s.health)}
                          {s.shield > 0 && (
                            <small>
                              <Shield size={11} />
                              {s.shield}
                            </small>
                          )}
                        </span>
                      </button>
                      <span className="player-mana">
                        <Diamond size={14} />
                        {s.mana}
                        <small>/10 MANA</small>
                      </span>
                    </div>
                    {index === 0 && (
                      <div
                        className="opponent-hand"
                        aria-label={`${s.handCount} hidden opponent cards`}
                      >
                        {Array.from(
                          { length: Math.min(s.handCount, 12) },
                          (_, i) => (
                            <span key={i}>
                              <Layers3 size={13} />
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    <div className="battle-board">
                      {s.board.map((u) => (
                        <div
                          className={`unit-wrapper ${targetIds.has(u.id) ? "legal-target" : ""} ${selection?.id === u.id ? "unit-selected" : ""} ${u.acted ? "unit-resting" : ""}`}
                          key={u.id}
                        >
                          <FriendCard
                            card={u}
                            compact
                            battle
                            selected={selection?.id === u.id}
                            onClick={() => {
                              if (targetIds.has(u.id)) target(u.id);
                              else if (
                                index === 1 &&
                                actions.some(
                                  (a) =>
                                    a.type === "attack" && a.unitId === u.id,
                                )
                              )
                                setSelection({
                                  kind: "attack",
                                  id: u.id,
                                  name: u.name,
                                });
                              else onInspect(u);
                            }}
                          />
                          <div className="unit-commands">
                            {index === 1 && (
                              <>
                                <button
                                  title={
                                    u.acted
                                      ? "Already acted or newly summoned"
                                      : "Select an attack target"
                                  }
                                  disabled={
                                    !actions.some(
                                      (a) =>
                                        a.type === "attack" &&
                                        a.unitId === u.id,
                                    )
                                  }
                                  onClick={() =>
                                    setSelection({
                                      kind: "attack",
                                      id: u.id,
                                      name: u.name,
                                    })
                                  }
                                >
                                  <Swords size={13} />
                                  Attack
                                </button>
                                <details>
                                  <summary
                                    role="button"
                                    aria-label={`Powers for ${u.name}`}
                                  >
                                    <Zap size={13} />
                                    Powers
                                    <ChevronDown size={10} />
                                  </summary>
                                  <div className="unit-power-menu">
                                    {u.abilities.map((a, i) => {
                                      const available = actions.some(
                                        (x) =>
                                          x.type === "ability" &&
                                          x.unitId === u.id &&
                                          x.abilityIndex === i,
                                      );
                                      return (
                                        <button
                                          key={a.type}
                                          disabled={!available}
                                          onClick={(e) => {
                                            e.currentTarget.closest(
                                              "details",
                                            ).open = false;
                                            setSelection({
                                              kind: "ability",
                                              id: u.id,
                                              index: i,
                                              name: a.name,
                                            });
                                          }}
                                        >
                                          <Icon
                                            effect={a.ability.effect}
                                            size={13}
                                          />
                                          <span>
                                            <strong>{a.name}</strong>
                                            <small>
                                              {TRIGGERS[a.ability.trigger]} ·{" "}
                                              {describeAbility(
                                                a.ability,
                                                u.superior,
                                              )}
                                            </small>
                                          </span>
                                          {a.ability.trigger === "active" && (
                                            <b>2◇</b>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </details>
                              </>
                            )}
                            {index === 0 && (
                              <button
                                className="inspect-unit"
                                onClick={() => onInspect(u)}
                              >
                                <Eye size={13} />
                                Inspect powers
                              </button>
                            )}
                          </div>
                          {index === 1 && (
                            <span className="unit-readiness">
                              {u.acted
                                ? "Resting this turn"
                                : u.usedAbilityRound === room.round
                                  ? "Ready · ability used"
                                  : "Ready to act"}
                            </span>
                          )}
                        </div>
                      ))}
                      {Array.from(
                        { length: Math.max(0, 3 - s.board.length) },
                        (_, i) => (
                          <div className="empty-board-slot" key={i}>
                            <Plus size={23} />
                            <span>
                              {index === 1
                                ? "Your friend here"
                                : "Their friend here"}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                    {index === 0 && (
                      <div className="battle-divider">
                        <span />
                        <div>
                          <Swords size={16} />
                          ROUND {Math.max(1, room.round + 1)}
                          <span>·</span>
                          <Timer size={13} />
                          {formatTime(room.endsAt - now)}
                        </div>
                        <span />
                      </div>
                    )}
                  </div>
                ),
            )}
            {finished && (
              <div className="result-overlay">
                <div className="result-emblem">
                  {room.winner === me.id ? (
                    <Crown size={42} />
                  ) : room.winner === null ? (
                    <Users size={42} />
                  ) : (
                    <Heart size={42} />
                  )}
                </div>
                <span className="fs-kicker">GOOD GAME. STILL FRIENDS.</span>
                <h2>
                  {room.winner === null
                    ? "Honours even."
                    : room.winner === me.id
                      ? "Your people came through."
                      : "A good friend. A worthy rival."}
                </h2>
                <p>
                  {room.reason === "forfeit"
                    ? "The opponent left the duel."
                    : room.reason === "time"
                      ? "The match clock has ended."
                      : "The final health point has fallen."}{" "}
                  {Math.max(0, me.health)} —{" "}
                  {Math.max(0, opponent?.health || 0)}
                </p>
                {room.hostId === me.id && room.seats.length === 2 ? (
                  <button
                    className="fs-primary"
                    onClick={() => send({ type: "rematch" })}
                  >
                    <RefreshCw size={16} />
                    Run it back
                  </button>
                ) : (
                  <p>Waiting for the host to open a rematch.</p>
                )}
                <button
                  className="fs-text"
                  onClick={() => send({ type: "leave" })}
                >
                  Back to the circle
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
          <div className="turn-controls">
            <div>
              <span className={`turn-indicator ${myTurn ? "your-turn" : ""}`}>
                <span />
                {finished
                  ? "Duel complete"
                  : myTurn
                    ? "Your turn. Make it count."
                    : `${opponent?.name || "Opponent"} is thinking…`}
              </span>
              <p>
                {selection
                  ? `${selection.name} — choose a highlighted target.`
                  : "Summon a friend, choose an attack, or use a power. Newly played friends rest for a turn."}
              </p>
            </div>
            {selection && (
              <button
                className="fs-secondary small"
                onClick={() => setSelection(null)}
              >
                <X size={14} />
                Cancel target
              </button>
            )}
            {selection?.kind === "reserve" &&
              relevant.some((a) => a.type === "superior") && (
                <button
                  className="fs-primary small"
                  onClick={() =>
                    act(relevant.find((a) => a.type === "superior"))
                  }
                >
                  Summon · 8 mana
                </button>
              )}
            <button
              className="end-turn"
              disabled={!myTurn || finished || status !== "connected"}
              onClick={() => act(actions.find((a) => a.type === "end"))}
            >
              <span>
                {myTurn && !finished ? formatTime(room.turnEndsAt - now) : "—"}
              </span>
              End turn
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="hand-zone">
            <div className="hand-heading">
              <span>
                <Layers3 size={15} />
                YOUR HAND<small>{me.hand?.length || 0} CARDS</small>
              </span>
              <span>
                <LockKeyhole size={12} />
                Only you can see these
              </span>
            </div>
            <div className="hand-cards">
              {me.hand?.map((c) =>
                c.kind === "friend" ? (
                  <div
                    className={`hand-card ${actions.some((a) => a.cardId === c.id) ? "playable" : ""}`}
                    key={c.id}
                  >
                    <FriendCard
                      card={c}
                      compact
                      selected={selection?.id === c.id}
                      onClick={() => chooseCard(c)}
                    />
                    <button
                      className="hand-play"
                      disabled={!actions.some((a) => a.cardId === c.id)}
                      onClick={() => chooseCard(c)}
                    >
                      Play friend · 3◇
                    </button>
                  </div>
                ) : (
                  <button
                    className={`power-hand-card ${c.color} ${selection?.id === c.id ? "selected" : ""}`}
                    disabled={!actions.some((a) => a.cardId === c.id)}
                    key={c.id}
                    onClick={() => chooseCard(c)}
                  >
                    <span className="power-card-cost">2◇</span>
                    <div className="power-card-art">
                      <Icon effect={c.effect} size={29} />
                      <span>FRIEND-LINKED POWER</span>
                    </div>
                    <h3>
                      {c.name.split(" ")[0]}’s {c.effect}
                    </h3>
                    <p>
                      {c.effect === "guard"
                        ? "Guard until the next turn"
                        : c.effect === "attack"
                          ? "+2 attack this turn"
                          : c.effect === "heal"
                            ? "Restore 2 health"
                            : "Give 2 shielding"}
                    </p>
                    <small>Needs {c.name.split(" ")[0]} on the board</small>
                  </button>
                ),
              )}
              {!me.hand?.length && (
                <p className="empty-hand">
                  Your hand is empty. A new card arrives next turn.
                </p>
              )}
              {me.reserve && !me.reserveUsed && (
                <button
                  className={`reserve-card ${selection?.kind === "reserve" ? "selected" : ""}`}
                  onClick={selectReserve}
                  disabled={
                    !actions.some((a) =>
                      ["superior", "upgrade"].includes(a.type),
                    )
                  }
                >
                  <Crown size={25} />
                  <span>SUPERIOR RESERVE</span>
                  <strong>{me.reserve.name}</strong>
                  <p>
                    Summon 8◇
                    <br />
                    Upgrade 5◇
                  </p>
                  <small>Once per duel</small>
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {showLog && (
        <Modal
          title="Every little plot twist"
          onClose={() => setShowLog(false)}
        >
          <div className="battle-log">
            {room.log.map((e) => (
              <div key={e.id}>
                <span />
                <p>{e.text}</p>
                <time>
                  {new Date(e.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {confirmLeave && (
        <Modal title="Leave the table?" onClose={() => setConfirmLeave(false)}>
          <p className="fs-modal-copy">
            {room.phase === "playing"
              ? "Leaving during a duel counts as a forfeit. Your collection and deck stay saved."
              : "Your collection and deck stay saved. You can start another table whenever you like."}
          </p>
          <div className="fs-modal-actions">
            <button
              className="fs-secondary"
              onClick={() => setConfirmLeave(false)}
            >
              Stay here
            </button>
            <button
              className="fs-danger"
              onClick={() => send({ type: "leave" })}
            >
              Leave table
              <LogOut size={15} />
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function CardApp() {
  const client = useCards(),
    { data, room, error, setError } = client;
  const [page, setPage] = useState("play"),
    [modal, setModal] = useState(null),
    [authMode, setAuthMode] = useState("register"),
    [toast, setToast] = useState(""),
    [deckId, setDeckId] = useState(""),
    [joinCode, setJoinCode] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [inviteText, setInviteText] = useState("");
  const selectedDeck =
    data?.decks.find((d) => d.id === deckId) || data?.decks[0];
  const inviteParam = new URLSearchParams(location.search).get("invite");
  useEffect(() => {
    if (data && inviteParam) setModal({ type: "claim", token: inviteParam });
  }, [!!data, inviteParam]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (room?.phase === "finished") client.refresh();
  }, [room?.phase]);
  async function work(fn) {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function needIdentity(fn) {
    if (!data) {
      setModal({ type: "auth" });
      return;
    }
    fn();
  }
  function play(solo) {
    needIdentity(() => {
      if (!selectedDeck) {
        setPage("decks");
        return;
      }
      client.send({ type: "create", deckId: selectedDeck.id, solo });
    });
  }
  function inspect(person) {
    setModal({ type: "profile", person });
  }
  async function invite(person) {
    await work(async () => {
      const r = await client.api(`/friends/${person.id}/invite`, {}),
        url = new URL(location.origin);
      url.searchParams.set("invite", r.token);
      setModal({ type: "invite", url: url.href, name: person.name });
    });
  }
  const sampleCards = SAMPLE_FRIENDS.map((p) => ({
    ...p,
    personId: p.id,
    cost: 3,
    attack: 2,
    health: 5,
    superior: false,
    sample: true,
    abilities: p.types.map((type) => ({
      type,
      name: CATALOG.find((t) => t.id === type).name,
      ability: defaultAbility(type),
    })),
  }));
  const people = data?.people || [],
    approved = people.reduce((sum, p) => sum + p.card.approvedCount, 0);
  const featured = data
    ? people.slice(0, 3).map((p) => ({ ...p.card, superior: false }))
    : sampleCards;
  const profile =
    modal?.type === "profile"
      ? data?.people.find((p) => p.id === modal.person.id) || modal.person
      : null;
  return (
    <div className="fs-app">
      <header className="fs-header">
        <a
          className="fs-brand"
          href="/"
          onClick={(e) => {
            if (room) {
              e.preventDefault();
              setToast(
                "Your table is still open. Use “Leave table” to return.",
              );
            } else {
              e.preventDefault();
              setPage("play");
            }
          }}
        >
          <span>
            <Layers3 size={24} />
          </span>
          friendstack<b>.</b>
        </a>
        <span className="fs-alpha">
          THE CARD GAME{" "}
          <small>
            {import.meta.env.VITE_SHARED_HOSTING
              ? "ONLINE ALPHA"
              : "LOCAL ALPHA"}
          </small>
        </span>
        <nav aria-label="Main navigation">
          {!import.meta.env.VITE_SHARED_HOSTING && (
            <a href="/football" className="football-link">
              <Gamepad2 size={14} />
              Football lab
              <ArrowUpRight size={12} />
            </a>
          )}
          <button
            className="fs-icon"
            aria-label="How to play"
            onClick={() => setModal({ type: "help" })}
          >
            <BookOpen size={19} />
          </button>
          {data ? (
            <>
              <button
                className="account-button"
                onClick={() => setModal({ type: "account" })}
              >
                <span>{data.user.name.slice(0, 2).toUpperCase()}</span>
                <b>{data.user.name}</b>
                <ChevronDown size={13} />
              </button>
            </>
          ) : (
            <button
              className="fs-secondary small"
              onClick={() => {
                setAuthMode("login");
                setModal({ type: "auth" });
              }}
            >
              Sign in
              <ArrowRight size={14} />
            </button>
          )}
        </nav>
      </header>
      <div className="fs-layout">
        <aside className="fs-sidebar">
          <div className="sidebar-label">YOUR LITTLE UNIVERSE</div>
          {[
            { id: "play", name: "Play", icon: Gamepad2 },
            { id: "circle", name: "Your circle", icon: Users },
            { id: "decks", name: "Deck builder", icon: Layers3 },
            { id: "approvals", name: "Approvals", icon: ShieldCheck },
            { id: "history", name: "Match history", icon: History },
          ].map((item) => (
            <button
              className={page === item.id ? "active" : ""}
              key={item.id}
              aria-label={item.name}
              onClick={() => {
                if (room) {
                  setToast(
                    "Finish or leave your table to browse your collection.",
                  );
                  return;
                }
                if (item.id !== "play" && !data) {
                  setModal({ type: "auth" });
                  return;
                }
                setPage(item.id);
              }}
            >
              <item.icon size={18} />
              <span>{item.name}</span>
              {item.id === "approvals" && data?.incoming.length > 0 && (
                <b>{data.incoming.length}</b>
              )}
              {page === item.id && <ChevronRight size={14} />}
            </button>
          ))}
          <div className="sidebar-bottom">
            <span className="fs-local">
              <span />
              {import.meta.env.VITE_SHARED_HOSTING
                ? "ONLINE PLAYGROUND"
                : "LOCAL PLAYGROUND"}
            </span>
            <p>
              Built around your people.
              <br />
              Played on your terms.
            </p>
            <span className="version-label">FRIENDSTACK / V0.2</span>
          </div>
        </aside>
        <main className="fs-main">
          {error && (
            <div className="fs-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {data && ["reconnecting", "elsewhere"].includes(client.status) && (
            <div className="fs-banner reconnect">
              <Wifi size={17} />
              {client.status === "elsewhere"
                ? "This identity is active in another window. Reload to move here."
                : "Recovering your connection. Your seat is held for 30 seconds."}
            </div>
          )}
          {room && data ? (
            <Battle
              client={client}
              onInspect={(card) => setModal({ type: "battleCard", card })}
            />
          ) : page === "play" ? (
            <>
              <section className="home-hero">
                <div className="hero-copy">
                  <span className="fs-kicker">
                    <span className="lime-star">✦</span> A CARD GAME WITH
                    CHARACTERS YOU ACTUALLY KNOW
                  </span>
                  <h1>
                    Your people.
                    <br />
                    <em>Your power.</em>
                  </h1>
                  <p>
                    That friend who always has your back?
                    <br />
                    They’re about to be your best card.
                  </p>
                  <div className="hero-actions">
                    <button className="fs-primary" onClick={() => play(true)}>
                      {data ? "Play a practice duel" : "Meet your first deck"}
                      <ArrowRight size={18} />
                    </button>
                    <button
                      className="hero-how"
                      onClick={() => setModal({ type: "help" })}
                    >
                      <span>↗</span>How it works
                    </button>
                  </div>
                  <div className="hero-social-proof">
                    <div>
                      {["M", "R", "N"].map((x, i) => (
                        <span
                          key={x}
                          className={["lavender", "peach", "mint"][i]}
                        >
                          {x}
                        </span>
                      ))}
                    </div>
                    <p>
                      Familiar faces. Unfamiliar powers.
                      <br />
                      <strong>
                        {data
                          ? `${people.length} friends in your circle`
                          : "Your group chat just got competitive."}
                      </strong>
                    </p>
                  </div>
                </div>
                <div className="hero-card-scene">
                  <span className="hero-orbit orbit-one" />
                  <span className="hero-orbit orbit-two" />
                  <div className="scene-spark spark-one">✳</div>
                  <div className="scene-spark spark-two">✧</div>
                  {featured.map((card, i) => (
                    <div
                      className={`scene-card scene-card-${i}`}
                      key={card.personId}
                    >
                      <FriendCard
                        card={card}
                        onClick={() =>
                          data ? inspect(people[i]) : setModal({ type: "auth" })
                        }
                      />
                    </div>
                  ))}
                  <div className="scene-caption">
                    <span /> REAL FRIENDS. LEGENDARY ENERGY.
                  </div>
                </div>
              </section>
              <div className="home-divider">
                <span>GOOD GAMES START WITH GOOD COMPANY.</span>
                <span>
                  <LockKeyhole size={12} />
                  Private by friendship. Personal by design.
                </span>
              </div>
              <section className="play-options">
                <div className="practice-panel">
                  <span className="panel-icon">
                    <Gamepad2 size={22} />
                  </span>
                  <div className="panel-tag">A LITTLE WARM-UP</div>
                  <h2>Find your rhythm.</h2>
                  <p>
                    Try your deck against the Practice Pal.
                    <br />
                    No pressure. Just a few friendly plot twists.
                  </p>
                  <button
                    className="fs-primary"
                    disabled={busy}
                    onClick={() => play(true)}
                  >
                    Practice with a bot
                    <ArrowRight size={17} />
                  </button>
                  <span className="panel-footnote">
                    <Sparkles size={12} />
                    Three fictional friends are ready to play.
                  </span>
                </div>
                <div className="private-panel">
                  <div className="private-panel-title">
                    <span className="panel-icon">
                      <Swords size={22} />
                    </span>
                    <span className="panel-tag">MAKE IT PERSONAL</span>
                    <span className="mode-tag">1V1</span>
                  </div>
                  <h2>Settle it with a friend.</h2>
                  <p>
                    A private table. Your own decks. Bragging rights included.
                  </p>
                  <label className="fs-field">
                    Bring this deck
                    <select
                      value={selectedDeck?.id || ""}
                      onChange={(e) => setDeckId(e.target.value)}
                      disabled={!data}
                    >
                      <option value="" disabled>
                        Your first deck is waiting
                      </option>
                      {data?.decks.map((d) => (
                        <option value={d.id} key={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="private-actions">
                    <button
                      className="fs-secondary"
                      onClick={() => play(false)}
                    >
                      <Plus size={16} />
                      Create a table
                      <ArrowUpRight size={16} />
                    </button>
                    <span>OR JOIN ONE</span>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        needIdentity(() =>
                          client.send({
                            type: "join",
                            code: joinCode,
                            deckId: selectedDeck?.id,
                          }),
                        );
                      }}
                    >
                      <input
                        aria-label="Card room code"
                        value={joinCode}
                        maxLength={8}
                        placeholder="ROOM CODE"
                        onChange={(e) =>
                          setJoinCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z2-9]/g, ""),
                          )
                        }
                      />
                      <button
                        aria-label="Join card table"
                        disabled={joinCode.length !== 6}
                      >
                        <ArrowRight size={18} />
                      </button>
                    </form>
                  </div>
                  <span className="panel-footnote">
                    <Timer size={12} />8 minute duels · 30 second turns · Still
                    friends afterwards
                  </span>
                </div>
              </section>
              <section className="home-bottom">
                <div>
                  <span className="fs-kicker">
                    {data
                      ? "YOUR COLLECTION, AT A GLANCE"
                      : "A LITTLE MORE HUMAN"}
                  </span>
                  <h3>
                    {data
                      ? "A circle worth playing."
                      : "Personality is the power-up."}
                  </h3>
                  <p>
                    {data
                      ? `${approved} approved personal traits across your friends. Every version tells a different story.`
                      : "Friends describe each other. Traits become powers. Your version of a friend is yours alone."}
                  </p>
                </div>
                <button
                  className="fs-text"
                  onClick={() => needIdentity(() => setPage("circle"))}
                >
                  {data ? "Explore your circle" : "Build your circle"}
                  <ArrowUpRight size={16} />
                </button>
              </section>
            </>
          ) : page === "circle" && data ? (
            <section>
              <div className="section-heading">
                <div>
                  <span className="fs-kicker">
                    FAMILIAR FACES. UNFAMILIAR POWERS.
                  </span>
                  <h1>
                    Your inner circle<span>.</span>
                  </h1>
                  <p>
                    Every friendship has a story. Yours happens to have
                    abilities.
                  </p>
                </div>
                <button
                  className="fs-primary"
                  onClick={() => setModal({ type: "add" })}
                >
                  <Plus size={17} />
                  Add a friend
                </button>
              </div>
              <div className="circle-toolbar">
                <label>
                  <Search size={16} />
                  <input
                    aria-label="Search friends"
                    placeholder="Find your people…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <span>
                  {people.length} FRIENDS <i /> {approved} PERSONAL TRAITS
                </span>
                <button
                  className="fs-text"
                  onClick={() => setModal({ type: "claim" })}
                >
                  <Link size={14} />
                  Claim an invitation
                </button>
              </div>
              <div className="friend-grid">
                {people
                  .filter((p) =>
                    p.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <div key={p.id} className="friend-grid-item">
                      <FriendCard
                        card={{ ...p.card, superior: false }}
                        onClick={() => inspect(p)}
                      />
                      <div className="friend-grid-caption">
                        <span>
                          {p.card.approvedCount}/12 discovered
                          {p.card.superior && <Crown size={13} />}
                        </span>
                        <button className="fs-text" onClick={() => inspect(p)}>
                          Their story
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                      {!p.sample && !p.claimed && (
                        <button
                          className="unclaimed-button"
                          onClick={() => invite(p)}
                        >
                          <Mail size={12} />
                          Invite to claim & approve
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              <div className="fs-notice circle-notice">
                <ShieldCheck size={19} />
                <p>
                  <strong>Some things stay between friends.</strong> Private
                  descriptions belong to you and the person described. Opponents
                  see approved public powers when a card is played.
                </p>
              </div>
            </section>
          ) : page === "decks" && data ? (
            <DeckBuilder
              data={data}
              client={client}
              onSaved={() => setToast("Deck saved. Your people are ready.")}
              onInspect={inspect}
            />
          ) : page === "approvals" && data ? (
            <section>
              <div className="section-heading">
                <div>
                  <span className="fs-kicker">YOUR CHARACTER. YOUR SAY.</span>
                  <h1>
                    A little perspective<span>.</span>
                  </h1>
                  <p>
                    Read the stories written about you and approve the powers
                    they become.
                  </p>
                </div>
                <button
                  className="fs-secondary"
                  onClick={() => setModal({ type: "claim" })}
                >
                  <Link size={15} />
                  Claim a friend profile
                </button>
              </div>
              {data.incoming.length ? (
                <div className="approvals-list">
                  {data.incoming.map((r) => (
                    <article className="approval-card" key={r.id}>
                      <header>
                        <span className="effect-icon">
                          <Icon effect={r.ability.effect} size={21} />
                        </span>
                        <div>
                          <span className="fs-kicker">
                            {r.authorName}’S PERSPECTIVE
                          </span>
                          <h3>{r.name}</h3>
                        </div>
                        <span className="state-badge pending">
                          Awaiting your say
                        </span>
                      </header>
                      <p className="private-description">
                        <Eye size={14} />
                        {r.description}
                      </p>
                      <div className="approval-ability">
                        <strong>{describeAbility(r.ability)}</strong>
                        <span>{TRIGGERS[r.ability.trigger]}</span>
                      </div>
                      <footer>
                        <span>
                          <LockKeyhole size={12} />
                          Just you and {r.authorName}
                        </span>
                        <button
                          className="fs-secondary small"
                          onClick={() =>
                            work(async () => {
                              await client.api(`/review/${r.id}`, {
                                approve: false,
                              });
                              await client.refresh();
                              setToast(
                                "Revision declined. Earlier approved powers stay intact.",
                              );
                            })
                          }
                        >
                          Decline
                        </button>
                        <button
                          className="fs-primary small"
                          onClick={() =>
                            work(async () => {
                              await client.api(`/review/${r.id}`, {
                                approve: true,
                              });
                              await client.refresh();
                              setToast(
                                "Approved. This power is ready for future duels.",
                              );
                            })
                          }
                        >
                          <Check size={14} />
                          Approve power
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="fs-empty large">
                  <ShieldCheck size={40} />
                  <h2>All good between friends.</h2>
                  <p>
                    No pending traits to review. Claim an invited profile to see
                    what your friends have written about you.
                  </p>
                </div>
              )}
            </section>
          ) : page === "history" && data ? (
            <section>
              <div className="section-heading">
                <div>
                  <span className="fs-kicker">THE FRIENDSHIPS SURVIVED.</span>
                  <h1>
                    The plot so far<span>.</span>
                  </h1>
                  <p>
                    Your duels are remembered, even after the server restarts.
                  </p>
                </div>
              </div>
              {data.matches.length ? (
                <div className="match-list">
                  {data.matches.map((m) => (
                    <div className={`match-row ${m.result}`} key={m.id}>
                      <span className="match-result-icon">
                        {m.result === "win" ? (
                          <Crown size={21} />
                        ) : m.result === "draw" ? (
                          <Users size={21} />
                        ) : (
                          <Heart size={21} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {m.result === "win"
                            ? "Your circle came through"
                            : m.result === "draw"
                              ? "Honours even"
                              : "A worthy rival"}
                        </strong>
                        <p>
                          vs {m.opponent} ·{" "}
                          {m.details.reason === "forfeit"
                            ? "Forfeit"
                            : m.details.reason === "time"
                              ? "Time limit"
                              : "Health defeat"}
                        </p>
                      </div>
                      <span>
                        {Math.max(0, m.details.health)} HP
                        <small>{m.details.turns} turns</small>
                      </span>
                      <time>{new Date(m.created).toLocaleDateString()}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="fs-empty large">
                  <Swords size={40} />
                  <h2>Your first story is waiting.</h2>
                  <p>Play a practice duel or invite a friend to your table.</p>
                  <button className="fs-primary" onClick={() => play(true)}>
                    Play your first duel
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          ) : null}
          <footer className="fs-footer">
            <span>
              <Layers3 size={14} />
              Less scrolling. More stories.
            </span>
            <span>
              <span className="footer-status" />{" "}
              {data
                ? client.status === "connected"
                  ? `${import.meta.env.VITE_SHARED_HOSTING ? "ONLINE SERVER" : "LOCAL SERVER"} · ${client.rtt ?? "…"} ms`
                  : "CONNECTING TO YOUR TABLE"
                : import.meta.env.VITE_SHARED_HOSTING
                  ? "ONLINE PLAYGROUND"
                  : "LOCAL PLAYGROUND"}
              <span className="footer-divider">/</span> BUILT FOR YOUR KIND OF
              PEOPLE.
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal.type === "auth"
              ? "Make yourself a character."
              : modal.type === "add"
                ? "Someone worth knowing."
                : modal.type === "trait"
                  ? `Another side of ${modal.person.name.split(" ")[0]}.`
                  : modal.type === "profile"
                    ? profile.name
                    : modal.type === "invite"
                      ? "A place in your circle."
                      : ["claim", "claimConfirm"].includes(modal.type)
                        ? "Is this your character?"
                        : modal.type === "battleCard"
                          ? modal.card.name
                          : modal.type === "account"
                            ? "Your saved identity."
                            : "A game built around your people."
          }
          wide={["trait", "profile", "help"].includes(modal.type)}
          onClose={() => setModal(null)}
        >
          {error && (
            <p className="fs-error" role="alert">
              {error}
            </p>
          )}
          {modal.type === "auth" && (
            <AuthForm
              client={client}
              mode={authMode}
              setMode={setAuthMode}
              onDone={() => setModal(null)}
            />
          )}
          {modal.type === "add" && (
            <form
              className="fs-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                work(async () => {
                  const p = await client.api("/friends", values);
                  await client.refresh();
                  setModal({ type: "trait", person: p });
                });
              }}
            >
              <p className="fs-modal-copy">
                Create their profile now. Invite them to claim it and approve
                the powers you design.
              </p>
              <label>
                Friend’s name
                <input
                  name="name"
                  required
                  maxLength={36}
                  placeholder="e.g. Alex Morgan"
                />
              </label>
              <label>
                Card colour
                <select name="color" aria-label="Card colour">
                  <option value="lavender">Lilac · A little mysterious</option>
                  <option value="mint">Mint · Calm confidence</option>
                  <option value="peach">Peach · Main-character energy</option>
                </select>
              </label>
              <label>
                Illustrated avatar
                <select name="face" aria-label="Illustrated avatar">
                  <option value="0">The ride or die</option>
                  <option value="1">The wild card</option>
                  <option value="2">The quiet storm</option>
                </select>
              </label>
              <button className="fs-primary" disabled={busy}>
                Add to your circle
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          {modal.type === "trait" && data && (
            <TraitForm
              person={modal.person}
              existing={modal.existing}
              client={client}
              onDone={() => {
                setModal(null);
                setToast("Trait saved. Your relationship history is growing.");
              }}
            />
          )}
          {modal.type === "profile" && data && (
            <CardDetails
              person={profile}
              user={data.user}
              onTrait={(existing) =>
                setModal({ type: "trait", person: profile, existing })
              }
              onInvite={() => invite(profile)}
            />
          )}
          {modal.type === "invite" && (
            <>
              <p className="fs-modal-copy">
                Share this single-use link directly with{" "}
                <strong>{modal.name}</strong>. They sign in as themselves, claim
                the profile, and review your descriptions. The link expires in
                seven days.
              </p>
              <label className="fs-field">
                Private invitation
                <input
                  value={modal.url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className="fs-primary"
                onClick={() =>
                  work(async () => {
                    try {
                      await navigator.clipboard.writeText(modal.url);
                      setToast("Private invitation copied.");
                    } catch {
                      setToast("Select and copy the invitation above.");
                    }
                  })
                }
              >
                <Copy size={16} />
                Copy invitation
              </button>
            </>
          )}
          {modal.type === "claim" && (
            <form
              className="fs-form"
              onSubmit={(e) => {
                e.preventDefault();
                work(async () => {
                  let token = modal.token || inviteText;
                  try {
                    token = new URL(token).searchParams.get("invite") || token;
                  } catch {}
                  const info = await client.api(
                    `/invite/${encodeURIComponent(token)}`,
                  );
                  setModal({
                    type: "claimConfirm",
                    token,
                    name: info.name,
                    creator: info.creator,
                  });
                });
              }}
            >
              <p className="fs-modal-copy">
                A friend made a character for you? Paste their invitation here.
                You’ll be able to read and approve their descriptions after
                claiming it.
              </p>
              <label>
                Invitation link or token
                <input
                  value={modal.token || inviteText}
                  onChange={(e) => {
                    setInviteText(e.target.value);
                    if (modal.token)
                      setModal({ ...modal, token: e.target.value });
                  }}
                  required
                  placeholder="Paste the link your friend shared"
                />
              </label>
              <button className="fs-primary" disabled={busy}>
                Look up invitation
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          {modal.type === "claimConfirm" && data && (
            <>
              <p className="fs-modal-copy">
                <strong>{modal.creator}</strong> created a profile named{" "}
                <strong>{modal.name}</strong>. Accept only if this profile
                represents you. It will link to your signed-in identity,{" "}
                <strong>{data.user.name}</strong>.
              </p>
              <button
                className="fs-primary"
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    await client.api("/claim", { token: modal.token });
                    await client.refresh();
                    history.replaceState(null, "", "/");
                    setModal(null);
                    setPage("approvals");
                    setToast("Profile claimed. Your perspective matters too.");
                  })
                }
              >
                <ShieldCheck size={17} />
                Claim my profile
              </button>
            </>
          )}
          {modal.type === "account" && data && (
            <>
              <div className="account-info">
                <span>{data.user.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <h3>{data.user.name}</h3>
                  <p>@{data.user.username}</p>
                </div>
              </div>
              <p className="fs-modal-copy">
                Your circle, traits, decks, and match results are saved on this
                game server. Each browser tab can sign into a different identity
                for testing.
              </p>
              <button
                className="fs-secondary"
                onClick={() =>
                  work(async () => {
                    await client.logout();
                    setModal(null);
                    setPage("play");
                  })
                }
              >
                <LogOut size={16} />
                Sign out of this identity
              </button>
            </>
          )}
          {modal.type === "battleCard" && (
            <div className="battle-inspect">
              <FriendCard card={modal.card} compact />
              {modal.card.abilities.map((a) => (
                <div className="power-row" key={a.type}>
                  <Icon effect={a.ability.effect} size={20} />
                  <div>
                    <strong>{a.name}</strong>
                    <p>{describeAbility(a.ability, modal.card.superior)}</p>
                    <small>{TRIGGERS[a.ability.trigger]}</small>
                  </div>
                </div>
              ))}
              <p className="fs-private">
                <LockKeyhole size={12} />
                Private relationship descriptions are never shared in battle.
              </p>
            </div>
          )}
          {modal.type === "help" && (
            <>
              <p className="fs-modal-copy">
                Your group chat, reimagined as a card game. Here’s the short
                version.
              </p>
              <div className="help-flow">
                {[
                  {
                    n: "01",
                    title: "Start with your people.",
                    text: "Create an identity. Your three fictional starter friends already have a deck and powers. Add real friends, describe them, and design their abilities.",
                  },
                  {
                    n: "02",
                    title: "Their character. Their say.",
                    text: "Invite a real friend to claim their profile. Only you and they can read your descriptions. They approve each new power before multiplayer; drafts work in solo practice.",
                  },
                  {
                    n: "03",
                    title: "Your friendship plays differently.",
                    text: "The most-endorsed trait types shape shared powers. Your personal discoveries stay with your version. Three approved personal types unlock a superior variant.",
                  },
                  {
                    n: "04",
                    title: "Take it to the table.",
                    text: "Start a solo duel or share a private table code. Six friend cards and six linked power-ups form your deck. Summon with mana, then attack or activate powers on later turns.",
                  },
                ].map((x) => (
                  <div key={x.n}>
                    <span>{x.n}</span>
                    <div>
                      <strong>{x.title}</strong>
                      <p>{x.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="help-rules">
                <span>
                  <Heart size={16} />
                  30 player health
                </span>
                <span>
                  <Timer size={16} />8 minute duels
                </span>
                <span>
                  <Zap size={16} />
                  30 second turns
                </span>
                <span>
                  <Users size={16} />3 board spaces
                </span>
              </div>
              <p className="fs-modal-copy">
                Friends cost 3 mana. Mana carries over and grows by 2 each turn,
                up to 10. Defeating friends earns limited bonus mana. Guarding
                friends protect their player. Each friend has one ability
                activation per round; triggered and active powers share that
                limit. Linked power-ups need their friend in play. A superior
                can be summoned for 8 mana or upgrade a matching friend for 5,
                once per duel. At zero player health you lose; at time, higher
                health wins. Equal health is a draw.
              </p>
              <button className="fs-primary" onClick={() => setModal(null)}>
                Good company. Let’s play.
                <ArrowRight size={17} />
              </button>
            </>
          )}
        </Modal>
      )}
      {toast && (
        <div className="fs-toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
