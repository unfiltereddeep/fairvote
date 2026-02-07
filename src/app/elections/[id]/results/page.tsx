"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase";

type PublicResultsDoc = {
  id: string;
  title: string;
  candidates: string[];
  counts: Record<string, number>;
  totalVotes: number;
  isPublished?: boolean;
  isClosed?: boolean;
};

export default function PublicResultsPage() {
  const params = useParams<{ id?: string }>();
  const electionId =
    typeof params?.id === "string" ? params.id : params?.id?.[0];
  const [loadingResults, setLoadingResults] = useState(true);
  const [resultsDoc, setResultsDoc] = useState<PublicResultsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!electionId) return;
    const firestore = db;
    if (!firestore) return;
    const loadResults = async () => {
      setLoadingResults(true);
      setError(null);
      try {
        const docSnap = await getDoc(doc(firestore, "results", electionId));
        if (!docSnap.exists()) {
          setResultsDoc(null);
          return;
        }
        setResultsDoc({
          id: docSnap.id,
          ...(docSnap.data() as Omit<PublicResultsDoc, "id">),
        });
      } catch (err) {
        setError("Failed to load results.");
      } finally {
        setLoadingResults(false);
      }
    };

    void loadResults();
  }, [electionId]);

  const configBanner = useMemo(() => {
    if (isFirebaseConfigured) return null;
    return (
      <div className="banner">
        Firebase isn’t configured yet. Add your Firebase web app config values
        to a `.env.local` file, then restart the dev server.
      </div>
    );
  }, []);

  if (loadingResults) {
    return (
      <div className="page">
        <div className="shell">
          <div className="card">Loading results...</div>
        </div>
      </div>
    );
  }

  if (!resultsDoc) {
    return (
      <div className="page">
        <div className="shell">
          <div className="card">
            <div className="stack">
              <strong>Results not found</strong>
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
          <span className="pill">Public results</span>
          <h1>{resultsDoc.title}</h1>
          <p>Anonymous results only. Voter identities are never shown here.</p>
        </section>

        {configBanner}
        {error && <div className="banner">{error}</div>}

        <section className="card">
          <div className="row">
            <Link className="button secondary" href={`/elections/${resultsDoc.id}`}>
              Back to election
            </Link>
            {resultsDoc.isClosed && <span className="pill">Voting closed</span>}
            {resultsDoc.isPublished && (
              <span className="pill">Results published</span>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Results</h2>
          {!resultsDoc.isPublished && (
            <span className="muted">Results are not published yet.</span>
          )}
          {resultsDoc.isPublished && (
            <div className="stack">
              <div className="list">
                {Object.entries(resultsDoc.counts ?? {}).map(
                  ([candidate, count]) => (
                    <div key={candidate} className="row">
                      <span>{candidate}</span>
                      <span className="tag">{count} votes</span>
                    </div>
                  )
                )}
              </div>
              <span className="muted">
                Total votes cast: {resultsDoc.totalVotes ?? 0}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
