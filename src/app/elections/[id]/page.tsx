"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type Election = {
  id: string;
  title: string;
  createdByUid: string;
  createdByEmail: string;
  maxSelections: number;
  candidates: string[];
  eligibleEmails: string[];
  isClosed?: boolean;
  resultsPublished?: boolean;
};

type Results = {
  counts: Record<string, number>;
  voters: string[];
  totalVotes: number;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export default function ElectionDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingElection, setLoadingElection] = useState(true);
  const [election, setElection] = useState<Election | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [voteSelections, setVoteSelections] = useState<string[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthReady(true);
      return;
    }

    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || !params.id) return;
    const loadElection = async () => {
      setLoadingElection(true);
      setError(null);
      try {
        const docSnap = await getDoc(doc(db, "elections", params.id));
        if (!docSnap.exists()) {
          setElection(null);
          return;
        }
        setElection({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Election, "id">),
        });
      } catch (err) {
        setError("Failed to load election.");
      } finally {
        setLoadingElection(false);
      }
    };

    void loadElection();
  }, [params.id]);

  useEffect(() => {
    if (!db || !user || !params.id) return;
    const checkVote = async () => {
      const voteDoc = doc(db, "votes", `${params.id}_${user.uid}`);
      const voteSnap = await getDoc(voteDoc);
      setHasVoted(voteSnap.exists());
    };
    void checkVote();
  }, [user, params.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShareUrl(`${window.location.origin}/elections/${params.id}`);
  }, [params.id]);

  const userEmail = user?.email ? normalizeEmail(user.email) : "";
  const isOwner = Boolean(
    election && user && election.createdByUid === user.uid
  );
  const isEligible =
    Boolean(election && userEmail) &&
    Boolean(election?.eligibleEmails.includes(userEmail));

  const handleSignIn = async () => {
    setError(null);
    if (!auth) {
      setError("Firebase is not configured yet.");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Sign-in failed. Please try again.");
      }
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const toggleSelection = (candidate: string, max: number) => {
    setVoteSelections((prev) => {
      if (prev.includes(candidate)) {
        return prev.filter((item) => item !== candidate);
      }
      if (prev.length >= max) return prev;
      return [...prev, candidate];
    });
  };

  const submitVote = async () => {
    setError(null);
    setNotice(null);
    if (!db || !user || !election) return;
    if (election.isClosed) {
      setError("Voting is closed for this election.");
      return;
    }

    if (voteSelections.length < 1 || voteSelections.length > election.maxSelections) {
      setError(
        `Select between 1 and ${election.maxSelections} candidates before voting.`
      );
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const voteRef = doc(db, "votes", `${election.id}_${user.uid}`);
        const voteSnap = await transaction.get(voteRef);
        if (voteSnap.exists()) {
          throw new Error("ALREADY_VOTED");
        }

        const resultsRef = doc(db, "results", election.id);
        const resultsSnap = await transaction.get(resultsRef);
        if (!resultsSnap.exists()) {
          throw new Error("RESULTS_MISSING");
        }

        voteSelections.forEach((candidate) => {
          transaction.update(resultsRef, {
            [`counts.${candidate}`]: increment(1),
          });
        });
        transaction.update(resultsRef, {
          totalVotes: increment(voteSelections.length),
          updatedAt: serverTimestamp(),
        });

        transaction.set(voteRef, {
          electionId: election.id,
          voterUid: user.uid,
          voterEmail: user.email ?? "",
          selections: voteSelections,
          createdAt: serverTimestamp(),
        });
      });
      setHasVoted(true);
      setNotice("Your vote is submitted. Thank you!");
    } catch (err) {
      if (err instanceof Error && err.message === "ALREADY_VOTED") {
        setError("You have already voted in this election.");
      } else if (err instanceof Error && err.message === "RESULTS_MISSING") {
        setError("Results setup is missing. Ask the creator to reopen and publish.");
      } else {
        setError("Failed to submit vote. Please try again.");
      }
    }
  };

  const loadResults = async () => {
    if (!db || !election) return;
    setLoadingResults(true);
    setError(null);
    try {
      const votesQuery = query(
        collection(db, "votes"),
        where("electionId", "==", election.id)
      );
      const votesSnapshot = await getDocs(votesQuery);
      const counts: Record<string, number> = {};
      election.candidates.forEach((candidate) => {
        counts[candidate] = 0;
      });
      const voters: string[] = [];
      let totalVotes = 0;
      votesSnapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as {
          voterEmail?: string;
          selections?: string[];
        };
        if (data.voterEmail) voters.push(data.voterEmail);
        if (Array.isArray(data.selections)) {
          data.selections.forEach((candidate) => {
            if (typeof counts[candidate] === "number") {
              counts[candidate] += 1;
            }
          });
          totalVotes += data.selections.length;
        }
      });
      setResults({
        counts,
        voters: Array.from(new Set(voters)),
        totalVotes,
      });
    } catch (err) {
      setError("Failed to load results.");
    } finally {
      setLoadingResults(false);
    }
  };

  const authEnabled = isFirebaseConfigured && Boolean(auth);

  const configBanner = useMemo(() => {
    if (isFirebaseConfigured) return null;
    return (
      <div className="banner">
        Firebase isn’t configured yet. Add your Firebase web app config values
        to a `.env.local` file, then restart the dev server.
      </div>
    );
  }, []);

  const closeAndPublish = async () => {
    if (!db || !election) return;
    setPublishing(true);
    setError(null);
    try {
      const resultsRef = doc(db, "results", election.id);
      const resultsSnap = await getDoc(resultsRef);
      let counts = election.candidates.reduce<Record<string, number>>(
        (acc, candidate) => {
          acc[candidate] = 0;
          return acc;
        },
        {}
      );
      let totalVotes = 0;

      let needsRecount = true;
      if (resultsSnap.exists()) {
        const data = resultsSnap.data() as {
          counts?: Record<string, number>;
          totalVotes?: number;
        };
        if (data.counts && Object.keys(data.counts).length > 0) {
          counts = data.counts;
          totalVotes = data.totalVotes ?? 0;
          needsRecount = false;
        }
      }

      if (needsRecount) {
        const votesSnapshot = await getDocs(
          query(
            collection(db, "votes"),
            where("electionId", "==", election.id)
          )
        );
        votesSnapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as { selections?: string[] };
          if (Array.isArray(data.selections)) {
            data.selections.forEach((candidate) => {
              if (typeof counts[candidate] === "number") {
                counts[candidate] += 1;
              }
            });
            totalVotes += data.selections.length;
          }
        });
      }

      await updateDoc(doc(db, "elections", election.id), {
        isClosed: true,
        resultsPublished: true,
      });
      await setDoc(
        resultsRef,
        {
          electionId: election.id,
          title: election.title,
          candidates: election.candidates,
          createdByUid: election.createdByUid,
          counts,
          totalVotes,
          isClosed: true,
          isPublished: true,
          publishedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setElection((prev) =>
        prev
          ? { ...prev, isClosed: true, resultsPublished: true }
          : prev
      );
    } catch (err) {
      setError("Failed to publish results.");
    } finally {
      setPublishing(false);
    }
  };

  const reopenVoting = async () => {
    if (!db || !election) return;
    setSavingStatus(true);
    setError(null);
    try {
      await updateDoc(doc(db, "elections", election.id), {
        isClosed: false,
      });
      await setDoc(
        doc(db, "results", election.id),
        {
          electionId: election.id,
          title: election.title,
          candidates: election.candidates,
          createdByUid: election.createdByUid,
          isClosed: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setElection((prev) =>
        prev ? { ...prev, isClosed: false } : prev
      );
    } catch (err) {
      setError("Failed to reopen voting.");
    } finally {
      setSavingStatus(false);
    }
  };

  if (loadingElection) {
    return (
      <div className="page">
        <div className="shell">
          <div className="card">Loading election...</div>
        </div>
      </div>
    );
  }

  if (!election) {
    return (
      <div className="page">
        <div className="shell">
          <div className="card">
            <div className="stack">
              <strong>Election not found</strong>
              <Link className="button secondary" href="/">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="shell">
        <section className="hero">
          <span className="pill">Election details</span>
          <h1>{election.title}</h1>
          <p>
            Share this link with eligible voters. Results stay anonymous while
            attendance is visible to the creator.
          </p>
        </section>

        {configBanner}

        <section className="card">
          <div className="row">
            <Link className="button secondary" href="/">
              Back to home
            </Link>
            <div className="stack">
              <strong>{user?.displayName ?? "Sign in to vote"}</strong>
              <span className="tag">{user?.email ?? "Not signed in"}</span>
            </div>
            {authReady && user ? (
              <button className="button secondary" onClick={handleSignOut}>
                Sign out
              </button>
            ) : (
              <button
                className="button"
                onClick={handleSignIn}
                disabled={!authEnabled}
              >
                Sign in
              </button>
            )}
          </div>
        </section>

        {error && <div className="banner">{error}</div>}
        {notice && <div className="banner">{notice}</div>}

        <section className="card">
          <div className="stack">
            <strong>Shareable URL</strong>
            <div className="row">
              <input className="input" value={shareUrl} readOnly />
              <button
                className="button secondary"
                onClick={() => navigator.clipboard.writeText(shareUrl)}
              >
                Copy
              </button>
            </div>
            <span className="tag">
              {election.candidates.length} candidates • Max{" "}
              {election.maxSelections} selections •{" "}
              {election.eligibleEmails.length} eligible voters
            </span>
            <div className="row">
              <Link
                className="button secondary"
                href={`/elections/${election.id}/results`}
              >
                Public results page
              </Link>
              {election.isClosed && <span className="pill">Voting closed</span>}
              {election.resultsPublished && (
                <span className="pill">Results published</span>
              )}
            </div>
          </div>
        </section>

        <div className="grid">
          <section className="card">
            <h2>Cast your vote</h2>
            {!user && (
              <span className="muted">
                Sign in with your eligible email to vote.
              </span>
            )}
            {user && !isEligible && (
              <span className="muted">
                Your email isn’t on the eligible voter list for this election.
              </span>
            )}
            {user && isEligible && election.isClosed && (
              <span className="muted">
                Voting is closed by the election creator.
              </span>
            )}
            {user && isEligible && (
              <div className="stack">
                <span className="tag">
                  Select between 1 and {election.maxSelections}
                </span>
                <div className="candidate-grid">
                  {election.candidates.map((candidate) => {
                    const checked = voteSelections.includes(candidate);
                    const reachedMax =
                      voteSelections.length >= election.maxSelections;
                    return (
                      <label key={candidate} className="checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            toggleSelection(candidate, election.maxSelections)
                          }
                          disabled={
                            hasVoted ||
                            election.isClosed ||
                            (!checked && reachedMax)
                          }
                        />
                        <span>{candidate}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="row">
                  <span className="muted">
                    Selected {voteSelections.length} /{" "}
                    {election.maxSelections}
                  </span>
                  <button
                    className="button"
                    onClick={submitVote}
                    disabled={hasVoted || election.isClosed}
                  >
                    {hasVoted ? "Vote submitted" : "Submit vote"}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Results & attendance</h2>
            {!isOwner && (
              <span className="muted">
                Only the election creator can view results and voter attendance.
              </span>
            )}
            {isOwner && (
              <div className="stack">
                <div className="row">
                  <button
                    className="button secondary"
                    onClick={loadResults}
                    disabled={loadingResults}
                  >
                    {loadingResults ? "Loading results..." : "Load results"}
                  </button>
                  {!election.isClosed && (
                    <button
                      className="button danger"
                      onClick={closeAndPublish}
                      disabled={publishing}
                    >
                      {publishing
                        ? "Publishing..."
                        : election.resultsPublished
                          ? "Close voting"
                          : "Close & publish results"}
                    </button>
                  )}
                  {election.isClosed && !election.resultsPublished && (
                    <button
                      className="button danger"
                      onClick={closeAndPublish}
                      disabled={publishing}
                    >
                      {publishing ? "Publishing..." : "Publish results"}
                    </button>
                  )}
                  {election.isClosed && (
                    <button
                      className="button secondary"
                      onClick={reopenVoting}
                      disabled={savingStatus}
                    >
                      {savingStatus ? "Saving..." : "Re-open voting"}
                    </button>
                  )}
                </div>
                {results && (
                  <div className="stack">
                    <div>
                      <strong>Results</strong>
                      <div className="list">
                        {Object.entries(results.counts).map(
                          ([candidate, count]) => (
                            <div key={candidate} className="row">
                              <span>{candidate}</span>
                              <span className="tag">{count} votes</span>
                            </div>
                          )
                        )}
                      </div>
                      <span className="muted">
                        Total votes cast: {results.totalVotes}
                      </span>
                    </div>
                    <div>
                      <strong>Voters who submitted</strong>
                      <div className="list">
                        {results.voters.length === 0 ? (
                          <span className="muted">No votes yet.</span>
                        ) : (
                          results.voters.map((email) => (
                            <span key={email} className="tag">
                              {email}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
