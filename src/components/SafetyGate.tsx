import { useState } from "react";
import { ShieldAlert, Plus, Trash2 } from "lucide-react";
import { recordSafetyConsent, type EmergencyContact } from "@/lib/fitStore";

function newContact(): EmergencyContact {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: "", phone: "" };
}

export function SafetyGate({
  existingContacts,
  onDone,
  mode,
}: {
  existingContacts: EmergencyContact[];
  onDone: () => void;
  /** "gate" blocks workout start until agreed; "edit" is reachable anytime
   * from the progress page to update contacts. */
  mode: "gate" | "edit";
}) {
  const [agreed, setAgreed] = useState(mode === "edit");
  const [contacts, setContacts] = useState<EmergencyContact[]>(
    existingContacts.length > 0 ? existingContacts : [newContact()],
  );

  const validContacts = contacts.filter((c) => c.name.trim() && c.phone.trim());
  const canSubmit = agreed && validContacts.length > 0;

  const updateContact = (id: string, patch: Partial<EmergencyContact>) => {
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const submit = () => {
    if (!canSubmit) return;
    recordSafetyConsent(validContacts);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/90 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-primary/30 bg-card p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <p className="font-display text-sm font-bold uppercase tracking-widest text-primary">
            {mode === "gate" ? "Before you start" : "Safety settings"}
          </p>
        </div>

        {mode === "gate" && (
          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border/70 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              I confirm I&apos;m physically able to do this workout and I&apos;m choosing to do it
              at my own risk. This app gives form feedback and can flag possible signs of trouble,
              but it does not replace medical supervision, a spotter, or calling local emergency
              services yourself if something feels wrong.
            </span>
          </label>
        )}

        <div className="mt-4">
          <p className="font-display text-xs font-bold uppercase tracking-widest text-foreground">
            Emergency contacts
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add at least one person we can prompt you to reach if the app flags something during a
            session — a raised-arms &quot;X&quot; gesture (or no movement for a while) opens a
            one-tap text/call to them. We never send anything automatically.
          </p>

          <div className="mt-3 space-y-2">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <input
                  value={c.name}
                  onChange={(e) => updateContact(c.id, { name: e.target.value })}
                  placeholder="Name"
                  className="h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  value={c.phone}
                  onChange={(e) => updateContact(c.id, { phone: e.target.value })}
                  placeholder="Phone"
                  type="tel"
                  className="h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {contacts.length > 1 && (
                  <button
                    onClick={() => setContacts((cs) => cs.filter((x) => x.id !== c.id))}
                    aria-label="Remove contact"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {contacts.length < 3 && (
            <button
              onClick={() => setContacts((cs) => [...cs, newContact()])}
              className="mt-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-primary"
            >
              <Plus className="h-3.5 w-3.5" /> Add another
            </button>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-5 w-full rounded-2xl bg-primary px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
        >
          {mode === "gate" ? "I agree — start training" : "Save"}
        </button>
        {mode === "edit" && (
          <button
            onClick={onDone}
            className="mt-2 w-full rounded-2xl border border-border py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Cancel
          </button>
        )}
        {!canSubmit && (
          <p className="mt-2 text-center text-[0.65rem] text-muted-foreground">
            {agreed
              ? "Add a name and phone number for at least one contact."
              : "Check the box above to continue."}
          </p>
        )}
      </div>
    </div>
  );
}
