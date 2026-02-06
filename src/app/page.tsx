"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
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

const uniqueList = (items: string[]) =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [maxSelections, setMaxSelections] = useState(1);
  const [candidatesInput, setCandidatesInput] = useState("");
  const [eligibleInput, setEligibleInput] = useState("");
  const [creating, setCreating] = useState(false);

  const [myElections, setMyElections] = useState<Election[]>([]);
  const [eligibleElections, setEligibleElections] = useState<Election[]>([]);
  const [voteSelections, setVoteSelections] = useState<
    Record<string, string[]>
  >({});
  const [voteStatus, setVoteStatus] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, Results>>({});
  const [loadingResults, setLoadingResults] = useState<Record<string, boolean>>(
    {}
  );

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
    if (!user || !db) {
      setMyElections([]);
      setEligibleElections([]);
      return;
    }
    const firestore = db;

    const load = async () => {
      setError(null);
      try {
        const myQuery = query(
          collection(firestore, "elections"),
          where("createdByUid", "==", user.uid),
          orderBy("createdAt", "desc")
        );
        const mySnapshot = await getDocs(myQuery);
        const myItems = mySnapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Election, "id">),
        }));
        setMyElections(myItems);

        const email = user.email ? normalizeEmail(user.email) : "";
        if (!email) {
          setEligibleElections([]);
          return;
        }
        const eligibleQuery = query(
          collection(firestore, "elections"),
          where("eligibleEmails", "array-contains", email),
          orderBy("createdAt", "desc")
        );
        const eligibleSnapshot = await getDocs(eligibleQuery);
        const eligibleItems = eligibleSnapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Election, "id">),
        }));
        setEligibleElections(eligibleItems);

        const status: Record<string, boolean> = {};
        await Promise.all(
          eligibleItems.map(async (election) => {
            const voteDoc = doc(firestore, "votes", `${election.id}_${user.uid}`);
            const voteSnap = await getDoc(voteDoc);
            status[election.id] = voteSnap.exists();
          })
        );
        setVoteStatus(status);
      } catch (err) {
        setError("Failed to load elections. Please refresh and try again.");
      }
    };

    void load();
  }, [user]);

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

  const handleCreateElection = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!db || !user) return;
    const firestore = db;

    const candidates = uniqueList(candidatesInput.split("\n")).map((item) =>
      item.trim()
    );
    const eligibleEmails = uniqueList(eligibleInput.split("\n")).map(
      normalizeEmail
    );

    if (!title.trim()) {
      setError("Please add a title for the voting post.");
      return;
    }
    if (candidates.length < 2) {
      setError("Please add at least two candidates.");
      return;
    }
    if (maxSelections < 1 || maxSelections > candidates.length) {
      setError("Max votes must be between 1 and number of candidates.");
      return;
    }
    if (eligibleEmails.length === 0) {
      setError("Please add at least one eligible voter email.");
      return;
    }

    setCreating(true);
    try {
      const newDoc = await addDoc(collection(firestore, "elections"), {
        title: title.trim(),
        createdByUid: user.uid,
        createdByEmail: user.email ?? "",
        maxSelections,
        candidates,
        eligibleEmails,
        isClosed: false,
        resultsPublished: false,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(firestore, "results", newDoc.id), {
        electionId: newDoc.id,
        title: title.trim(),
        candidates,
        counts: candidates.reduce<Record<string, number>>((acc, candidate) => {
          acc[candidate] = 0;
          return acc;
        }, {}),
        totalVotes: 0,
        isPublished: false,
        isClosed: false,
        createdByUid: user.uid,
        updatedAt: serverTimestamp(),
      });
      setTitle("");
      setMaxSelections(1);
      setCandidatesInput("");
      setEligibleInput("");
      setNotice("Election created. Redirecting to details...");
      router.push(`/elections/${newDoc.id}`);
    } catch (err) {
      setError("Failed to create election. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const toggleSelection = (
    electionId: string,
    candidate: string,
    max: number
  ) => {
    setVoteSelections((prev) => {
      const current = prev[electionId] ?? [];
      const exists = current.includes(candidate);
      if (exists) {
        return { ...prev, [electionId]: current.filter((c) => c !== candidate) };
      }
      if (current.length >= max) return prev;
      return { ...prev, [electionId]: [...current, candidate] };
    });
  };

  const submitVote = async (election: Election) => {
    setError(null);
    setNotice(null);
    if (!db || !user) return;
    const firestore = db;
    if (election.isClosed) {
      setError("Voting is closed for this election.");
      return;
    }

    const selections = voteSelections[election.id] ?? [];
    if (selections.length < 1 || selections.length > election.maxSelections) {
      setError(
        `Select between 1 and ${election.maxSelections} candidates before voting.`
      );
      return;
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        const voteRef = doc(firestore, "votes", `${election.id}_${user.uid}`);
        const voteSnap = await transaction.get(voteRef);
        if (voteSnap.exists()) {
          throw new Error("ALREADY_VOTED");
        }

        const resultsRef = doc(firestore, "results", election.id);
        const resultsSnap = await transaction.get(resultsRef);
        if (!resultsSnap.exists()) {
          throw new Error("RESULTS_MISSING");
        }

        selections.forEach((candidate) => {
          transaction.update(resultsRef, {
            [`counts.${candidate}`]: increment(1),
          });
        });
        transaction.update(resultsRef, {
          totalVotes: increment(selections.length),
          updatedAt: serverTimestamp(),
        });

        transaction.set(voteRef, {
          electionId: election.id,
          voterUid: user.uid,
          voterEmail: user.email ?? "",
          selections,
          createdAt: serverTimestamp(),
        });
      });
      setVoteStatus((prev) => ({ ...prev, [election.id]: true }));
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

  const loadResults = async (election: Election) => {
    if (!db) return;
    const firestore = db;
    setLoadingResults((prev) => ({ ...prev, [election.id]: true }));
    try {
      const votesQuery = query(
        collection(firestore, "votes"),
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
      setResults((prev) => ({
        ...prev,
        [election.id]: {
          counts,
          voters: Array.from(new Set(voters)),
          totalVotes,
        },
      }));
    } catch (err) {
      setError("Failed to load results. Please try again.");
    } finally {
      setLoadingResults((prev) => ({ ...prev, [election.id]: false }));
    }
  };

  const userEmail = user?.email ? normalizeEmail(user.email) : "";

  const configBanner = useMemo(() => {
    if (isFirebaseConfigured) return null;
    return (
      <div className="banner">
        Firebase isn’t configured yet. Add your Firebase web app config values
        to a `.env.local` file, then restart the dev server.
      </div>
    );
  }, []);

  const authEnabled = isFirebaseConfigured && Boolean(auth);

  return (
    <div className="page">
      <div className="shell">
        <section className="hero">
          <span className="pill">FairVote • Private elections</span>
          <h1>Run trusted votes without revealing who voted for whom.</h1>
          <p>
            Create a voting post, invite eligible voters by email, and collect
            anonymous results. You’ll see who voted, but not their selections.
          </p>
        </section>

        {configBanner}

        <section className="card">
          <div className="row">
            {authReady && user ? (
              <>
                <div className="stack">
                  <strong>{user.displayName ?? "Signed in"}</strong>
                  <span className="tag">{user.email}</span>
                </div>
                <button className="button secondary" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <div className="stack">
                  <strong>Sign in with Google</strong>
                  <span className="muted">
                    You’ll use this to create and vote in elections.
                  </span>
                </div>
                <button
                  className="button"
                  onClick={handleSignIn}
                  disabled={!authEnabled}
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </section>

        {error && <div className="banner">{error}</div>}
        {notice && <div className="banner">{notice}</div>}

        {user ? (
          <>
            <div className="grid">
              <section className="card">
                <h2>Create a voting post</h2>
                <form className="stack" onSubmit={handleCreateElection}>
                  <div className="field">
                    <label>Title</label>
                    <input
                      className="input"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Team Lead Election 2026"
                    />
                  </div>
                  <div className="field">
                    <label>Max selections per voter</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={maxSelections}
                      onChange={(event) =>
                        setMaxSelections(Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Candidate names (one per line)</label>
                    <textarea
                      className="textarea"
                      value={candidatesInput}
                      onChange={(event) => setCandidatesInput(event.target.value)}
                      placeholder={"Ava Patel\nNoah Carter\nLiam Chen"}
                    />
                  </div>
                  <div className="field">
                    <label>Eligible voter emails (one per line)</label>
                    <textarea
                      className="textarea"
                      value={eligibleInput}
                      onChange={(event) => setEligibleInput(event.target.value)}
                      placeholder={"voter1@email.com\nvoter2@email.com"}
                    />
                  </div>
                  <button className="button" disabled={creating}>
                    {creating ? "Creating..." : "Create voting post"}
                  </button>
                </form>
              </section>

              <section className="card">
                <h2>Your voting posts</h2>
                <p className="muted">
                  See results and attendance. Votes are anonymous.
                </p>
                <div className="list">
                  {myElections.length === 0 && (
                    <span className="muted">
                      No posts yet. Create your first election.
                    </span>
                  )}
                  {myElections.map((election) => {
                    const currentResults = results[election.id];
                    return (
                      <div key={election.id} className="election-card">
                        <div className="stack">
                          <strong>{election.title}</strong>
                          <span className="tag">
                            {election.candidates.length} candidates • Max{" "}
                            {election.maxSelections} votes per voter •{" "}
                            {election.eligibleEmails.length} eligible
                          </span>
                          <div className="row">
                            <Link
                              className="button secondary"
                              href={`/elections/${election.id}`}
                            >
                              Open details
                            </Link>
                            <Link
                              className="button secondary"
                              href={`/elections/${election.id}/results`}
                            >
                              Public results
                            </Link>
                            <span className="tag">Shareable URL ready</span>
                          </div>
                          <button
                            className="button secondary"
                            onClick={() => loadResults(election)}
                            disabled={loadingResults[election.id]}
                          >
                            {loadingResults[election.id]
                              ? "Loading results..."
                              : "Load results"}
                          </button>
                          {currentResults && (
                            <div className="stack">
                              <div>
                                <strong>Results</strong>
                                <div className="list">
                                  {Object.entries(currentResults.counts).map(
                                    ([candidate, count]) => (
                                      <div key={candidate} className="row">
                                        <span>{candidate}</span>
                                        <span className="tag">{count} votes</span>
                                      </div>
                                    )
                                  )}
                                </div>
                                <span className="muted">
                                  Total votes cast: {currentResults.totalVotes}
                                </span>
                              </div>
                              <div>
                                <strong>Voters who submitted</strong>
                                <div className="list">
                                  {currentResults.voters.length === 0 ? (
                                    <span className="muted">No votes yet.</span>
                                  ) : (
                                    currentResults.voters.map((email) => (
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
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <section className="card">
              <h2>Participate in voting</h2>
              <p className="muted">
                You can vote only in posts where your email is listed as eligible.
              </p>
              <div className="list">
                {eligibleElections.length === 0 && (
                  <span className="muted">
                    No voting posts available for {userEmail}.
                  </span>
                )}
                {eligibleElections.map((election) => {
                  const selections = voteSelections[election.id] ?? [];
                  const hasVoted = voteStatus[election.id];
                  return (
                    <div key={election.id} className="election-card">
                      <div className="stack">
                        <div className="row">
                          <strong>{election.title}</strong>
                          {hasVoted && <span className="pill">Voted</span>}
                          {election.isClosed && (
                            <span className="pill">Closed</span>
                          )}
                        </div>
                        <div className="row">
                          <Link
                            className="button secondary"
                            href={`/elections/${election.id}`}
                          >
                            Open voting page
                          </Link>
                          <Link
                            className="button secondary"
                            href={`/elections/${election.id}/results`}
                          >
                            Public results
                          </Link>
                        </div>
                        <span className="tag">
                          Choose up to {election.maxSelections}
                        </span>
                        <div className="candidate-grid">
                          {election.candidates.map((candidate) => {
                            const checked = selections.includes(candidate);
                            const reachedMax =
                              selections.length >= election.maxSelections;
                            return (
                              <label key={candidate} className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    toggleSelection(
                                      election.id,
                                      candidate,
                                      election.maxSelections
                                    )
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
                            Selected {selections.length} /{" "}
                            {election.maxSelections}
                          </span>
                          <button
                            className="button"
                            onClick={() => submitVote(election)}
                            disabled={hasVoted || election.isClosed}
                          >
                            Submit vote
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="card">
            <h2>Sign in to continue</h2>
            <p className="muted">
              Create voting posts, view your posts, and participate in votes
              after signing in with Google.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
