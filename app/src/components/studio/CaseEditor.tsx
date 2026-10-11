"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import type { CaseProfile } from "@/lib/types";
import { openHigh, type ConsistencyResult, type Issue } from "@/lib/studio/checks";
import { applyPatch, type PatchOp } from "@/lib/studio/patch";
import { SECTIONS, type SectionId } from "@/lib/studio/profile";
import type { CaseMeta } from "@/lib/studio/store";
import { StatusBadges } from "./CaseLibrary";
import ConsistencyPanel from "./ConsistencyPanel";
import { api, Dialog, Notice, startTestVisit } from "./fields";
import GuidePanel from "./GuidePanel";
import StudentPreview from "./StudentPreview";
import { ActionsSection } from "./sections/Actions";
import { ArtifactsSection } from "./sections/Artifacts";
import { AnswerSection, ChartSection, MismatchesSection, ObjectivesSection, OverviewSection, PatientSection, ScenarioSection } from "./sections/Basics";
import { FactsSection } from "./sections/Facts";
import { KnowledgeSection } from "./sections/Knowledge";
import { RubricSection, type RubricOption } from "./sections/Rubric";
import { VariantsSection } from "./sections/Variants";

type SaveState = "saved" | "dirty" | "saving" | "error";
interface Gate {
  high: Issue[];
  checked: boolean;
  clinicalReviewRan: boolean;
  stale: boolean;
  reviewed: boolean;
  origin: string;
}
type Role = { id: string; name: string; roleTitle: string };

const AUTOSAVE_MS = 1200;

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50" onClick={onClick}>
      {label}
    </button>
  );
}

export default function CaseEditor({
  meta: initialMeta,
  initialProfile,
  initialConsistency,
  initialHash,
  rubrics: initialRubrics,
  roles,
  created,
}: {
  meta: CaseMeta;
  initialProfile: CaseProfile;
  initialConsistency: ConsistencyResult | null;
  initialHash: string;
  rubrics: RubricOption[];
  roles: Role[];
  created: boolean;
}) {
  const router = useRouter();
  const id = initialMeta.id;
  const [meta, setMeta] = useState(initialMeta);
  const [profile, setProfileState] = useState(initialProfile);
  const [cons, setConsState] = useState(initialConsistency);
  const [savedHash, setSavedHash] = useState(initialHash);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [section, setSection] = useState<SectionId>("overview");
  const [guideOpen, setGuideOpen] = useState(false);
  const [rubrics, setRubrics] = useState(initialRubrics);
  const [check, setCheck] = useState<{ running: boolean; seconds: number; error: string | null }>({ running: false, seconds: 0, error: null });
  const [gate, setGate] = useState<Gate | null>(null);
  const [gateAck, setGateAck] = useState(false);
  const [gateReviewed, setGateReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [undo, setUndo] = useState<{ profile: CaseProfile; cons: ConsistencyResult | null; label: string; covered: boolean }[]>([]);
  /**
   * True while the consistency check still covers the patient: nothing has changed since it ran except
   * the check's own suggested fixes. Applying one of those must not make the check read as out of date.
   */
  const [covered, setCoveredState] = useState(!!initialConsistency && initialConsistency.profileHash === initialHash);
  const coveredRef = useRef(covered);
  const setCovered = useCallback((v: boolean) => {
    coveredRef.current = v;
    setCoveredState(v);
  }, []);
  /** Edit counter right after the most recent accepted change (or undo), to tell whether hand edits followed it. */
  const undoMark = useRef(0);
  const [showIntro, setShowIntro] = useState(created);

  // The refs hold the truth for saving; state mirrors them for rendering.
  const profileRef = useRef(profile);
  const consRef = useRef(cons);
  const consDirty = useRef(false);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (savedVersion.current === version.current) return true;
    const v = version.current;
    const sendCons = consDirty.current;
    const covers = sendCons && coveredRef.current && !!consRef.current;
    setSaveState("saving");
    const run = (async () => {
      try {
        const r = await api<{ hash: string; updatedAt: string }>(`/api/cases/${id}`, { method: "PUT", json: { profile: profileRef.current, ...(sendCons ? { consistency: consRef.current, consistencyCovers: covers } : {}) } });
        savedVersion.current = v;
        // The server stamped the stored check with the new hash; mirror that here without marking anything dirty.
        if (covers && consRef.current && consRef.current.profileHash !== r.hash) {
          consRef.current = { ...consRef.current, profileHash: r.hash };
          setConsState(consRef.current);
        }
        if (sendCons && version.current === v) consDirty.current = false;
        setSavedHash(r.hash);
        setSaveError("");
        if (version.current === v) setSaveState("saved");
        else {
          setSaveState("dirty");
          schedule();
        }
        return true;
      } catch (e) {
        setSaveError((e as Error).message);
        setSaveState("error");
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [id, schedule]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const touch = useCallback(() => {
    version.current++;
    setSaveState("dirty");
    schedule();
  }, [schedule]);

  const set = useCallback(
    (fn: (p: CaseProfile) => CaseProfile) => {
      const next = fn(profileRef.current);
      if (next === profileRef.current) return;
      profileRef.current = next;
      setProfileState(next);
      // Any edit puts the patient ahead of the last check. applyFix and undo restore the flag afterwards.
      setCovered(false);
      touch();
    },
    [touch, setCovered],
  );
  const setCons = useCallback(
    (next: ConsistencyResult | null) => {
      consRef.current = next;
      consDirty.current = true;
      setConsState(next);
      touch();
    },
    [touch],
  );
  const profileNow = useCallback(() => profileRef.current, []);
  const go = useCallback((s: SectionId) => {
    setSection(s);
    window.scrollTo({ top: 0 });
  }, []);

  // The guide is a column on very wide screens and starts open there. Up to 1535px (which includes a 1280x720
  // projector laptop) there is no room for it beside the facts table, so it is a drawer and starts closed.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1536px)");
    const t = requestAnimationFrame(() => wide.matches && setGuideOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);
  // Warn on a hard unload with unsaved edits; flush on in-app navigation.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (savedVersion.current !== version.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void saveRef.current();
    };
  }, []);
  useEffect(() => {
    if (!check.running) return;
    const t0 = Date.now();
    const t = setInterval(() => setCheck((c) => ({ ...c, seconds: Math.round((Date.now() - t0) / 1000) })), 1000);
    return () => clearInterval(t);
  }, [check.running]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const stale = !!cons && !covered && (cons.profileHash !== savedHash || saveState !== "saved");
  const highOpen = openHigh(cons).length;
  const issuesOpen = (cons?.issues || []).filter((i) => i.status === "open").length;

  function pushUndo(label: string) {
    // Capture now: the updater below runs later, after the refs have moved on.
    const snapshot = { profile: profileRef.current, cons: consRef.current, label, covered: coveredRef.current };
    setUndo((u) => [...u.slice(-9), snapshot]);
  }
  function undoLast() {
    const last = undo[undo.length - 1];
    if (!last) return;
    if (version.current > undoMark.current && !window.confirm("You have edited the patient since that change. Undoing restores the patient to how it was before the change, so those later edits are lost too. Continue?")) return;
    setUndo((u) => u.slice(0, -1));
    consRef.current = last.cons;
    consDirty.current = true;
    setConsState(last.cons);
    set(() => last.profile);
    // Back to a state the check covered (for example undoing one of its own fixes): it is current again.
    setCovered(last.covered);
    undoMark.current = version.current;
    setFlash({ tone: "green", text: `Undone: ${last.label}` });
  }

  /** Applies edits the faculty member has just accepted. */
  function acceptOps(ops: PatchOp[], label: string): { applied: number; errors: string[] } {
    const r = applyPatch(profileRef.current, ops);
    if (r.applied) {
      pushUndo(label);
      set(() => r.profile);
      undoMark.current = version.current;
    }
    return { applied: r.applied, errors: r.errors.map((e) => `${e.op.path}: ${e.message}`) };
  }
  function applyFix(issue: Issue): string | null {
    if (!issue.fix) return null;
    const r = applyPatch(profileRef.current, issue.fix.ops);
    if (!r.applied) return "This fix no longer fits the patient as it is now. Edit the section by hand, or run the check again.";
    pushUndo(`fix for "${issue.title}"`);
    const wasCovered = coveredRef.current;
    set(() => r.profile);
    // A fix the check itself proposed does not make the check out of date; the finding is marked resolved instead.
    setCovered(wasCovered);
    if (consRef.current) setCons({ ...consRef.current, issues: consRef.current.issues.map((i) => (i.id === issue.id ? { ...i, status: "fixed" } : i)) });
    undoMark.current = version.current;
    return r.errors.length ? `${r.applied} of ${issue.fix.ops.length} edits were applied; the rest no longer fit. Review ${issue.where}.` : null;
  }
  const setIssueStatus = (issueId: string, status: Issue["status"]) => consRef.current && setCons({ ...consRef.current, issues: consRef.current.issues.map((i) => (i.id === issueId ? { ...i, status } : i)) });

  async function runCheck() {
    go("consistency");
    setCheck({ running: true, seconds: 0, error: null });
    try {
      if (!(await save())) throw new Error("The patient could not be saved, so it was not checked. " + saveError);
      const checkedVersion = version.current;
      const r = await api<{ consistency: ConsistencyResult }>(`/api/cases/${id}/check`, { json: {} });
      consRef.current = r.consistency;
      setConsState(r.consistency);
      // Edits made while the check was running are not covered by it.
      setCovered(version.current === checkedVersion);
      setCheck({ running: false, seconds: 0, error: null });
    } catch (e) {
      setCheck({ running: false, seconds: 0, error: (e as Error).message });
    }
  }

  async function doing(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMenu(false);
    try {
      await fn();
    } catch (e) {
      setFlash({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const mustSave = async () => {
    if (!(await save())) throw new Error("Your latest edits could not be saved. Fix that first.");
  };
  const status = (action: string, extra: Record<string, unknown> = {}) => api<{ meta: CaseMeta; gate?: Gate }>(`/api/cases/${id}/status`, { json: { action, ...extra } });

  const testVisit = () =>
    doing("test", async () => {
      await mustSave();
      router.push(await startTestVisit(id));
    });
  const openPublish = () =>
    doing("publish", async () => {
      await mustSave();
      const r = await status("publish", { dryRun: true });
      setGateAck(false);
      setGateReviewed(false);
      setGate(r.gate!);
    });
  const confirmPublish = () =>
    doing("publish", async () => {
      await mustSave();
      const r = await status("publish", { force: gateAck, markReviewed: gateReviewed });
      setMeta(r.meta);
      setGate(null);
      setFlash({ tone: "green", text: "Published. Students can now start this visit. Edits you save from here on apply to new visits." });
    });
  const simple = (action: string, done: string) =>
    doing(action, async () => {
      const r = await status(action);
      setMeta(r.meta);
      setFlash({ tone: "green", text: done });
    });

  const toggleReviewed = () => (meta.reviewed ? simple("unreview", "Marked as not reviewed.") : simple("review", "Marked as faculty-reviewed."));
  const duplicate = () =>
    doing("dup", async () => {
      await mustSave();
      const r = await api<{ id: string }>(`/api/cases/${id}/duplicate`, { json: {} });
      router.push(`/faculty/cases/${r.id}`);
    });
  const exportJson = () =>
    doing("export", async () => {
      await mustSave();
      const a = document.createElement("a");
      a.href = `/api/cases/${id}/export`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  const toggleArchive = () => {
    if (meta.status === "archived") return simple("restore", "Restored as a draft.");
    if (window.confirm(meta.status === "published" ? "This patient is published. Archiving removes it from students' lists. Archive it?" : "Archive this patient? You can restore it from the library.")) return simple("archive", "Archived.");
    setMenu(false);
  };

  const counts: Partial<Record<SectionId, number>> = {
    facts: profile.facts.length,
    actions: profile.actions.length,
    artifacts: profile.artifacts.length,
    objectives: profile.objectives.length,
    mismatches: profile.mismatches?.length || 0,
    knowledge: profile.knowledge.length,
    variants: profile.variants?.length || 0,
  };
  const sp = { p: profile, set, go };
  const roleTitle = roles.find((r) => r.id === profile.professions[0])?.roleTitle || "clinician";
  const navBtn = (sid: SectionId, label: string, right?: React.ReactNode) => (
    <button key={sid} type="button" onClick={() => go(sid)} aria-current={section === sid ? "page" : undefined} className={cx("flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm", section === sid ? "bg-brand-600 font-medium text-white" : "text-slate-700 hover:bg-slate-100")}>
      {/* Labels wrap rather than truncate: "Consistency check" beside "out of date" must stay readable. */}
      <span className="min-w-0 leading-snug">{label}</span>
      {right !== undefined && <span className={cx("shrink-0 whitespace-nowrap text-xs", section === sid ? "text-brand-100" : "text-slate-400")}>{right}</span>}
    </button>
  );

  return (
    <div>
      {/* Top bar */}
      <div className="sticky top-0 z-30 -mx-4 -mt-5 mb-4 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Link href="/faculty/cases" className="text-slate-500 hover:text-slate-900">
                Patient Studio
              </Link>
              <span className="text-slate-300">/</span>
              <StatusBadges c={meta} />
              <span
                role="status"
                className={cx("ml-1", saveState === "saved" && "text-slate-400", saveState === "dirty" && "text-amber-700", saveState === "saving" && "text-slate-500", saveState === "error" && "font-medium text-rose-700")}
              >
                {saveState === "saved" && "All changes saved"}
                {saveState === "dirty" && "Unsaved changes"}
                {saveState === "saving" && "Saving..."}
                {saveState === "error" && `Not saved: ${saveError}`}
              </span>
              {(saveState === "dirty" || saveState === "error") && (
                <button type="button" className="text-brand-700 underline" onClick={() => void save()}>
                  {saveState === "error" ? "Retry" : "Save now"}
                </button>
              )}
            </div>
            {/* The patient's name comes first and never truncates; the faculty title follows and may take a second line. */}
            <h1 className="line-clamp-2 text-base leading-snug text-slate-900" title={profile.title || undefined}>
              <span className="whitespace-nowrap font-semibold">
                {profile.patient.name || "Unnamed patient"}, {profile.patient.age}
              </span>
              <span className="ml-2 text-sm font-normal text-slate-600">{profile.title || "Untitled patient"}</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {undo.length > 0 && (
              <Button variant="ghost" size="sm" onClick={undoLast} title={`Undo: ${undo[undo.length - 1].label}`}>
                Undo last accepted change
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={runCheck} disabled={check.running}>
              {check.running ? `Checking... ${check.seconds}s` : "Check consistency"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => go("preview")}>
              Student preview
            </Button>
            <Button variant="secondary" size="sm" onClick={testVisit} disabled={busy === "test" || meta.status === "archived"} title="Saves, then starts a visit with this patient as a student would see it. Works for drafts.">
              {busy === "test" ? "Starting..." : "Test visit"}
            </Button>
            {meta.status === "published" ? (
              <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => simple("unpublish", "Unpublished. The patient is a draft again and students can no longer start it.")}>
                Unpublish
              </Button>
            ) : (
              <Button size="sm" disabled={!!busy || meta.status === "archived"} onClick={openPublish}>
                {busy === "publish" ? "Checking..." : "Publish"}
              </Button>
            )}
            <div className="relative">
              <Button variant="ghost" size="sm" onClick={() => setMenu(!menu)} aria-expanded={menu}>
                More
              </Button>
              {menu && (
                <div className="absolute right-0 z-40 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
                  <MenuItem label={meta.reviewed ? "Remove the faculty-reviewed mark" : "Mark as faculty-reviewed"} onClick={toggleReviewed} />
                  <MenuItem label="Duplicate" onClick={duplicate} />
                  <MenuItem label="Export JSON" onClick={exportJson} />
                  <MenuItem label={meta.status === "archived" ? "Restore from archive" : "Archive"} onClick={toggleArchive} />
                </div>
              )}
            </div>
            <Button variant={guideOpen ? "ghost" : "secondary"} size="sm" onClick={() => setGuideOpen(!guideOpen)}>
              {guideOpen ? "Hide guide" : "Ask the guide"}
            </Button>
          </div>
        </div>
      </div>

      {flash && (
        <Notice tone={flash.tone} className="mb-3">
          {flash.text}
        </Notice>
      )}
      {profile.dataSource && (
        <Notice tone="teal" className="mb-3">
          <p className="text-sm">
            {profile.dataSource.kind === "synthea" ? (
              <>
                <span className="font-medium">Clinical record from data.</span> This patient&rsquo;s name, age, sex, problem list, medications, allergies, vital signs, laboratory results and immunisations come from {profile.dataSource.dataset}, record {profile.dataSource.recordId}. They are in the chart summary, the documents
                &ldquo;Problem list and history&rdquo;, &ldquo;Medication list&rdquo; and &ldquo;Laboratory results&rdquo;, and the actions &ldquo;Vital signs&rdquo;, &ldquo;Recent laboratory results&rdquo; and &ldquo;Immunisation record&rdquo;. The guide drafted the personality, the conversation and the teaching design.
              </>
            ) : (
              <>
                <span className="font-medium">Clinical values from data.</span> Blood glucose, HbA1c, lipids, haemoglobin, MCV and blood pressure come from {profile.dataSource.dataset}, row {profile.dataSource.row} (labelled {profile.dataSource.conditionLabel}). They are in the document &ldquo;Laboratory results&rdquo; and
                the actions &ldquo;Blood tests&rdquo; and &ldquo;Blood pressure&rdquo;. Everything else about this patient was drafted by the guide.
              </>
            )}
          </p>
        </Notice>
      )}
      {showIntro && (
        <Notice tone="teal" className="mb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">The guide has drafted this patient. It is yours to correct.</p>
              <p className="mt-0.5 text-sm">
                It stays labelled &ldquo;AI-drafted, not faculty-reviewed&rdquo; until you mark it reviewed. A sensible order: read Facts and Documents (what students can discover and when), run the consistency check, try a test visit, then publish. Type a request to the guide on the right
                for any change you would rather describe than make by hand.
              </p>
            </div>
            <button type="button" className="shrink-0 text-xs underline" onClick={() => setShowIntro(false)}>
              Dismiss
            </button>
          </div>
        </Notice>
      )}

      <div className={cx("grid items-start gap-4", guideOpen ? "lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)_22rem]" : "lg:grid-cols-[15rem_minmax(0,1fr)]")}>
        {/* Section navigation */}
        <nav aria-label="Sections" className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-[5.75rem] lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto">
          <p className="px-2.5 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Patient profile</p>
          {SECTIONS.map((s) => navBtn(s.id, s.label, counts[s.id]))}
          <p className="mt-2 border-t border-slate-100 px-2.5 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Before publishing</p>
          {navBtn(
            "consistency",
            "Consistency check",
            check.running ? "running" : !cons ? "not run" : highOpen ? <span className={section === "consistency" ? "" : "font-semibold text-rose-700"}>{highOpen} high</span> : stale ? "out of date" : issuesOpen ? `${issuesOpen} open` : "clear",
          )}
          {navBtn("preview", "Student preview")}
        </nav>

        {/* Section editor */}
        <div className="min-w-0">
          {section === "overview" && <OverviewSection {...sp} roles={roles} />}
          {section === "patient" && <PatientSection {...sp} />}
          {section === "scenario" && <ScenarioSection {...sp} />}
          {section === "chart" && <ChartSection {...sp} />}
          {section === "facts" && <FactsSection {...sp} />}
          {section === "actions" && <ActionsSection {...sp} />}
          {section === "artifacts" && <ArtifactsSection {...sp} />}
          {section === "objectives" && <ObjectivesSection {...sp} />}
          {section === "answer" && <AnswerSection {...sp} />}
          {section === "mismatches" && <MismatchesSection {...sp} />}
          {section === "knowledge" && <KnowledgeSection {...sp} />}
          {section === "rubric" && <RubricSection {...sp} rubrics={rubrics} setRubrics={setRubrics} />}
          {section === "variants" && <VariantsSection {...sp} profileNow={profileNow} caseId={id} />}
          {section === "consistency" && <ConsistencyPanel p={profile} result={cons} stale={stale} running={check.running} seconds={check.seconds} error={check.error} onRun={runCheck} onApply={applyFix} onStatus={setIssueStatus} go={go} />}
          {section === "preview" && <StudentPreview p={profile} roleTitle={roleTitle} />}
        </div>

        {/* Guide: a column from 1536px up, a drawer otherwise */}
        {guideOpen && (
          <div className="fixed inset-y-0 right-0 z-40 w-[25rem] max-w-[92vw] p-2 2xl:sticky 2xl:inset-auto 2xl:top-[5.75rem] 2xl:z-auto 2xl:h-[calc(100vh-6.75rem)] 2xl:w-auto 2xl:max-w-none 2xl:p-0">
            <GuidePanel caseId={id} profileNow={profileNow} onAccept={acceptOps} onClose={() => setGuideOpen(false)} />
          </div>
        )}
      </div>

      {gate && (
        <Dialog
          title="Publish this patient"
          onClose={() => setGate(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setGate(null)}>
                Cancel
              </Button>
              {(!gate.checked || gate.stale || gate.high.length > 0) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setGate(null);
                    void runCheck();
                  }}
                >
                  {gate.high.length ? "Review the issues" : "Run the check first"}
                </Button>
              )}
              <Button variant={gate.high.length ? "danger" : "primary"} disabled={busy === "publish" || (gate.high.length > 0 && !gateAck)} onClick={confirmPublish}>
                {gate.high.length ? "Publish anyway" : "Publish"}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              Publishing makes <span className="font-medium text-slate-900">{profile.patient.name}</span> available to students in: {profile.professions.map((r) => roles.find((x) => x.id === r)?.name || r).join(", ") || "no role selected"}.
            </p>
            {gate.high.length > 0 ? (
              <Notice tone="red">
                <p className="font-medium">
                  {gate.high.length} high-severity issue{gate.high.length === 1 ? " is" : "s are"} still open:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {gate.high.map((i) => (
                    <li key={i.id}>
                      {i.title} <span className="text-xs opacity-75">({i.where})</span>
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex items-start gap-1.5">
                  <input type="checkbox" className="mt-0.5" checked={gateAck} onChange={(e) => setGateAck(e.target.checked)} />
                  <span>I have read these issues and want to publish anyway.</span>
                </label>
              </Notice>
            ) : gate.checked && !gate.stale && gate.clinicalReviewRan ? (
              <Notice tone="green">The consistency check found no open high-severity issues.</Notice>
            ) : null}
            {!gate.checked && <Notice tone="amber">The consistency check has not been run on this patient. Structure was checked just now and is fine{gate.high.length ? " apart from the issues above" : ""}, but nothing has reviewed the clinical content for contradictions.</Notice>}
            {gate.checked && gate.stale && <Notice tone="amber">The patient has been edited since the last consistency check, so the clinical review does not cover your latest changes.</Notice>}
            {gate.checked && !gate.stale && !gate.clinicalReviewRan && <Notice tone="amber">The last check did not complete its clinical review. Only structure has been checked.</Notice>}
            {gate.origin === "ai_draft" && !gate.reviewed && (
              <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <input type="checkbox" className="mt-0.5" checked={gateReviewed} onChange={(e) => setGateReviewed(e.target.checked)} />
                <span>
                  I have reviewed the clinical content of this AI-drafted patient. Mark it as faculty-reviewed.
                  <span className="block text-xs opacity-80">If you leave this unticked it is published with the label &ldquo;AI-drafted, not faculty-reviewed&rdquo;.</span>
                </span>
              </label>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
