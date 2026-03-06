"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type MatchMode = "serious" | "enjoy"; // ガチ / エンジョイ
type MatchType = "single" | "double"; // シングル / ダブル

type Member = {
  id: string;
  name: string;
  activeToday: boolean;
  /** 試合履歴再計算時の初期レート（未指定時は INITIAL_RATING） */
  initialRating?: number;
  /** 管理者フラグ（複数可）。管理者は毎試合最低1名が休憩になるよう優先される */
  isAdmin?: boolean;
  /** 性別（ペア表示で色分け: 男=青・女=赤） */
  gender?: "male" | "female";
  /** 初心者フラグ（ペア表示で🔰を表示） */
  isBeginner?: boolean;
};

type MemberStats = {
  rating: number;
  wins: number;
  losses: number;
  seriousWins: number;
  seriousLosses: number;
  enjoyWins: number;
  enjoyLosses: number;
};

type WinnerSide = "A" | "B";

type GeneratedCourt = {
  courtNumber: number;
  /** 「○コート」の○部分。未指定時は courtNumber を表示 */
  courtLabel?: string;
  teamAIds: string[];
  teamBIds: string[];
  mode: MatchMode;
  matchType: MatchType;
};

type MatchRecord = {
  id: string;
  timestamp: string;
  mode: MatchMode;
  matchType: MatchType;
  courtNumber: number;
  teamAIds: string[];
  teamBIds: string[];
  winner: WinnerSide;
};

const INITIAL_RATING = 1000;
const K_FACTOR = 32;
const MAX_RATING_GAP_FOR_PAIR_AVOID = 150;

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function calculateExpectedScore(ratingA: number, ratingB: number) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateWinRate(wins: number, losses: number) {
  const total = wins + losses;
  if (total === 0) return 0;
  return (wins / total) * 100;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const MEMBERS_STORAGE_KEY = "badminton_members_v1";
const MATCHES_STORAGE_KEY = "badminton_matches_v1";

type StoredMember = {
  id: string;
  name: string;
  activeToday?: boolean;
  initialRating?: number;
  isAdmin?: boolean;
  gender?: "male" | "female";
  isBeginner?: boolean;
};

function memberFromStorage(m: StoredMember): Member {
  return {
    id: m.id,
    name: m.name,
    activeToday: m.activeToday ?? false,
    initialRating: m.initialRating ?? INITIAL_RATING,
    isAdmin: m.isAdmin ?? false,
    gender: m.gender,
    isBeginner: m.isBeginner ?? false,
  };
}

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [newMemberName, setNewMemberName] = useState("");
  const [selectedTab, setSelectedTab] = useState<
    "members" | "pair" | "pairDisplay" | "history" | "stats"
  >("members");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberNameValue, setEditMemberNameValue] = useState("");
  const [editMemberRatingValue, setEditMemberRatingValue] = useState("");

  const [matchMode, setMatchMode] = useState<MatchMode>("serious");
  const [matchType, setMatchType] = useState<MatchType>("double");
  const [courtCount, setCourtCount] = useState(4);
  const [generatedCourts, setGeneratedCourts] = useState<GeneratedCourt[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  type SwapSource =
    | { type: "court"; courtIdx: number; team: "A" | "B"; playerIdx: number }
    | { type: "rest"; id: string };
  const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
  const [chartMemberId, setChartMemberId] = useState<string>("");
  const [statsDetailMemberId, setStatsDetailMemberId] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // 初期ロード（Supabase があればそこから、なければ localStorage）
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (supabase) {
        const { data, error } = await supabase
          .from("app_data")
          .select("key, value")
          .in("key", ["members", "matches"]);
        if (!cancelled && !error && data) {
          const membersRow = data.find((r) => r.key === "members");
          const matchesRow = data.find((r) => r.key === "matches");
          const storedMembers = (membersRow?.value as StoredMember[] | null) ?? [];
          const storedMatches = (matchesRow?.value as MatchRecord[] | null) ?? [];
          setMembers(storedMembers.map(memberFromStorage));
          setMatches(Array.isArray(storedMatches) ? storedMatches : []);
        } else if (!cancelled && error) {
          console.error("Supabase load error:", error);
          const storedMembers = loadFromStorage<StoredMember[]>(MEMBERS_STORAGE_KEY, []);
          const storedMatches = loadFromStorage<MatchRecord[]>(MATCHES_STORAGE_KEY, []);
          setMembers(storedMembers.map(memberFromStorage));
          setMatches(storedMatches);
        }
      } else {
        const storedMembers = loadFromStorage<StoredMember[]>(MEMBERS_STORAGE_KEY, []);
        const storedMatches = loadFromStorage<MatchRecord[]>(MATCHES_STORAGE_KEY, []);
        setMembers(storedMembers.map(memberFromStorage));
        setMatches(storedMatches);
      }
      if (!cancelled) setDataLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 永続化（Supabase があればそこへ、なければ localStorage）
  useEffect(() => {
    if (!dataLoaded) return;
    if (supabase) {
      supabase
        .from("app_data")
        .upsert(
          [
            {
              key: "members",
              value: members.map((m) => ({
                id: m.id,
                name: m.name,
                activeToday: m.activeToday,
                initialRating: m.initialRating ?? INITIAL_RATING,
                isAdmin: m.isAdmin ?? false,
                gender: m.gender ?? null,
                isBeginner: m.isBeginner ?? false,
              })),
            },
          ],
          { onConflict: "key" },
        )
        .then(({ error }) => {
          if (error) console.error("Supabase save members error:", error);
        });
    } else {
      saveToStorage(MEMBERS_STORAGE_KEY, members);
    }
  }, [members, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    if (supabase) {
      supabase
        .from("app_data")
        .upsert([{ key: "matches", value: matches }], { onConflict: "key" })
        .then(({ error }) => {
          if (error) console.error("Supabase save matches error:", error);
        });
    } else {
      saveToStorage(MATCHES_STORAGE_KEY, matches);
    }
  }, [matches, dataLoaded]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.activeToday),
    [members],
  );

  // 試合履歴からレート・勝敗を再計算（履歴修正時に正しく反映される）
  const memberStatsMap = useMemo(() => {
    const map = new Map<string, MemberStats>();
    const emptyStats = (): MemberStats => ({
      rating: INITIAL_RATING,
      wins: 0,
      losses: 0,
      seriousWins: 0,
      seriousLosses: 0,
      enjoyWins: 0,
      enjoyLosses: 0,
    });
    for (const m of members) {
      map.set(m.id, {
        ...emptyStats(),
        rating: m.initialRating ?? INITIAL_RATING,
      });
    }
    for (const match of matches) {
      const teamAIds = match.teamAIds;
      const teamBIds = match.teamBIds;
      const get = (id: string) => map.get(id) ?? emptyStats();

      if (match.mode === "enjoy") {
        const aWon = match.winner === "A" ? 1 : 0;
        const bWon = match.winner === "B" ? 1 : 0;
        for (const id of teamAIds) {
          const cur = get(id);
          map.set(id, {
            ...cur,
            wins: cur.wins + aWon,
            losses: cur.losses + bWon,
            enjoyWins: cur.enjoyWins + aWon,
            enjoyLosses: cur.enjoyLosses + bWon,
          });
        }
        for (const id of teamBIds) {
          const cur = get(id);
          map.set(id, {
            ...cur,
            wins: cur.wins + bWon,
            losses: cur.losses + aWon,
            enjoyWins: cur.enjoyWins + bWon,
            enjoyLosses: cur.enjoyLosses + aWon,
          });
        }
      } else {
        const ratingA =
          teamAIds.reduce((s, id) => s + get(id).rating, 0) /
          Math.max(teamAIds.length, 1);
        const ratingB =
          teamBIds.reduce((s, id) => s + get(id).rating, 0) /
          Math.max(teamBIds.length, 1);
        const expectedA = calculateExpectedScore(ratingA, ratingB);
        const scoreA = match.winner === "A" ? 1 : 0;
        const scoreB = match.winner === "B" ? 1 : 0;
        const deltaA = K_FACTOR * (scoreA - expectedA);
        const deltaB = K_FACTOR * (scoreB - (1 - expectedA));
        const aWon = match.winner === "A" ? 1 : 0;
        const bWon = match.winner === "B" ? 1 : 0;
        for (const id of teamAIds) {
          const cur = get(id);
          map.set(id, {
            ...cur,
            rating: Math.round(cur.rating + deltaA),
            wins: cur.wins + aWon,
            losses: cur.losses + bWon,
            seriousWins: cur.seriousWins + aWon,
            seriousLosses: cur.seriousLosses + bWon,
          });
        }
        for (const id of teamBIds) {
          const cur = get(id);
          map.set(id, {
            ...cur,
            rating: Math.round(cur.rating + deltaB),
            wins: cur.wins + bWon,
            losses: cur.losses + aWon,
            seriousWins: cur.seriousWins + bWon,
            seriousLosses: cur.seriousLosses + aWon,
          });
        }
      }
    }
    return map;
  }, [members, matches]);

  const getMemberStats = (id: string): MemberStats =>
    memberStatsMap.get(id) ?? {
      rating: INITIAL_RATING,
      wins: 0,
      losses: 0,
      seriousWins: 0,
      seriousLosses: 0,
      enjoyWins: 0,
      enjoyLosses: 0,
    };

  const handleAddMember = () => {
    const name = newMemberName.trim();
    if (!name) return;
    setMembers((prev) => [
      ...prev,
      {
        id: createId(),
        name,
        activeToday: true,
        initialRating: INITIAL_RATING,
        isAdmin: false,
        gender: "male",
        isBeginner: false,
      },
    ]);
    setNewMemberName("");
  };

  const handleDeleteMember = (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("このメンバーを削除しますか？")) return;
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleUpdateMemberName = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, name: trimmed } : m)),
    );
  };

  const handleUpdateMemberInitialRating = (id: string, value: number) => {
    const v = Math.round(Math.max(0, Math.min(3000, value)));
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, initialRating: v } : m)),
    );
  };

  const toggleActiveToday = (id: string) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, activeToday: !m.activeToday } : m,
      ),
    );
  };

  const toggleAdmin = (id: string) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, isAdmin: !m.isAdmin } : m,
      ),
    );
  };

  const setMemberGender = (id: string, gender: "male" | "female") => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, gender } : m)),
    );
  };

  const toggleBeginner = (id: string) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, isBeginner: !(m.isBeginner ?? false) } : m,
      ),
    );
  };

  const handleResetToday = () => {
    setMembers((prev) => prev.map((m) => ({ ...m, activeToday: false })));
    setGeneratedCourts([]);
  };

  const pairKey = (a: string, b: string) => [a, b].sort().join("-");

  const handleGeneratePairs = () => {
    setErrorMessage(null);
    setGeneratedCourts([]);

    const players = [...activeMembers];
    const neededPerCourt = matchType === "single" ? 2 : 4;
    const maxPlayersUsable = courtCount * neededPerCourt;

    if (players.length < neededPerCourt) {
      setErrorMessage(
        matchType === "single"
          ? "シングルスを行うには最低2人の参加者が必要です。"
          : "ダブルスを行うには最低4人の参加者が必要です。",
      );
      return;
    }

    const activeAdmins = players.filter((m) => m.isAdmin);
    const restCount = Math.max(0, players.length - maxPlayersUsable);

    let playingPool: Member[];
    if (activeAdmins.length > 0 && restCount > 0) {
      const byParticipation = [...players].sort(
        (a, b) =>
          (participationCountToday.get(b.id) ?? 0) -
          (participationCountToday.get(a.id) ?? 0),
      );
      const restPool: Member[] = [];
      const adminByPart = byParticipation.filter((m) => m.isAdmin);
      if (adminByPart.length > 0) {
        restPool.push(adminByPart[0]);
      }
      for (const p of byParticipation) {
        if (restPool.length >= restCount) break;
        if (restPool.includes(p)) continue;
        restPool.push(p);
      }
      playingPool = players.filter((p) => !restPool.includes(p));
    } else {
      playingPool = [...players];
      playingPool.sort(
        (a, b) =>
          getMemberStats(a.id).rating - getMemberStats(b.id).rating,
      );
      playingPool = playingPool.slice(0, maxPlayersUsable);
    }

    if (playingPool.length < neededPerCourt) {
      setErrorMessage(
        "管理者を最低1名休憩に回すと出場人数が足りません。参加者を増やすか管理者を外してください。",
      );
      return;
    }

    playingPool.sort(
      (a, b) =>
        getMemberStats(a.id).rating - getMemberStats(b.id).rating,
    );

    const courts: GeneratedCourt[] = [];

    if (matchMode === "serious") {
      if (matchType === "single") {
        const list = playingPool.slice(0, courtCount * 2);
        const chunked: Member[][] = [];
        for (let i = 0; i < list.length; i += 2) {
          if (i + 1 >= list.length) break;
          let a = list[i];
          let b = list[i + 1];
          if (usedPairsToday.has(pairKey(a.id, b.id)) && i + 3 < list.length) {
            const c = list[i + 2];
            const d = list[i + 3];
            const gapOrig = Math.abs(getMemberStats(a.id).rating - getMemberStats(b.id).rating);
            const gapSwap = Math.abs(getMemberStats(a.id).rating - getMemberStats(c.id).rating);
            if (gapSwap <= gapOrig + MAX_RATING_GAP_FOR_PAIR_AVOID && !usedPairsToday.has(pairKey(a.id, c.id))) {
              b = c;
            }
          }
          chunked.push([a, b]);
        }
        for (let court = 1; court <= courtCount && court <= chunked.length; court++) {
          const pair = chunked[court - 1];
          courts.push({
            courtNumber: court,
            teamAIds: [pair[0].id],
            teamBIds: [pair[1].id],
            mode: "serious",
            matchType: "single",
          });
        }
      } else {
        const list = playingPool.slice(0, courtCount * 4);
        const teams: Member[][] = [];
        let i = 0;
        while (i < list.length) {
          if (i + 1 >= list.length) break;
          const a = list[i];
          const b = list[i + 1];
          if (
            i + 4 <= list.length &&
            usedPairsToday.has(pairKey(a.id, b.id))
          ) {
            const c = list[i + 2];
            const d = list[i + 3];
            const gapAb = Math.abs(getMemberStats(a.id).rating - getMemberStats(b.id).rating);
            const gapAc = Math.abs(getMemberStats(a.id).rating - getMemberStats(c.id).rating);
            if (
              gapAc <= gapAb + MAX_RATING_GAP_FOR_PAIR_AVOID &&
              !usedPairsToday.has(pairKey(a.id, c.id)) &&
              a.id !== c.id &&
              b.id !== d.id
            ) {
              teams.push([a, c]);
              teams.push([b, d]);
              i += 4;
              continue;
            }
          }
          teams.push([a, b]);
          i += 2;
        }
        teams.sort((a, b) => {
          const ra = a.reduce((s, m) => s + getMemberStats(m.id).rating, 0) / 2;
          const rb = b.reduce((s, m) => s + getMemberStats(m.id).rating, 0) / 2;
          return ra - rb;
        });
        for (let j = 0; j < teams.length; j += 2) {
          if (j + 1 >= teams.length) break;
          courts.push({
            courtNumber: courts.length + 1,
            teamAIds: teams[j].map((m) => m.id),
            teamBIds: teams[j + 1].map((m) => m.id),
            mode: "serious",
            matchType: "double",
          });
        }
      }
    } else {
      if (matchType === "single") {
        const n = playingPool.length;
        const pairs: Member[][] = [];
        for (let i = 0; i < Math.floor(n / 2); i++) {
          const low = playingPool[i];
          const high = playingPool[n - 1 - i];
          if (!low || !high) continue;
          pairs.push([low, high]);
        }
        for (let court = 1; court <= courtCount && court <= pairs.length; court++) {
          const pair = pairs[court - 1];
          courts.push({
            courtNumber: court,
            teamAIds: [pair[0].id],
            teamBIds: [pair[1].id],
            mode: "enjoy",
            matchType: "single",
          });
        }
      } else {
        const n = playingPool.length;
        const half = Math.floor(n / 2);
        const lowGroup = playingPool.slice(0, half);
        const highGroup = playingPool.slice(n - half);
        const tempTeams: Member[][] = [];
        const len = Math.min(lowGroup.length, highGroup.length);
        for (let i = 0; i < len; i++) {
          const a = lowGroup[i];
          const b = highGroup[len - 1 - i];
          if (a && b) tempTeams.push([a, b]);
        }
        for (let i = 0; i < tempTeams.length; i += 2) {
          if (i + 1 >= tempTeams.length) break;
          courts.push({
            courtNumber: courts.length + 1,
            teamAIds: tempTeams[i].map((m) => m.id),
            teamBIds: tempTeams[i + 1].map((m) => m.id),
            mode: "enjoy",
            matchType: "double",
          });
        }
      }
    }

    if (courts.length === 0) {
      setErrorMessage("参加人数が足りないためペアを生成できませんでした。");
      return;
    }

    // 厳格バリデーション: 1人1回のみ。同一人物が複数コート・同一試合に2回出ないこと
    const usedIds = new Set<string>();
    let valid = true;
    for (const court of courts) {
      const ids = [...court.teamAIds, ...court.teamBIds];
      const inCourt = new Set(ids);
      if (inCourt.size !== ids.length) {
        valid = false;
        break;
      }
      for (const id of ids) {
        if (usedIds.has(id)) {
          valid = false;
          break;
        }
        usedIds.add(id);
      }
      if (!valid) break;
    }
    if (!valid) {
      setErrorMessage("ペア生成で重複が検出されました。もう一度お試しください。");
      return;
    }

    setGeneratedCourts(courts);
  };

  const handleRecordResult = (court: GeneratedCourt, winner: WinnerSide) => {
    setMatches((prev) => [
      ...prev,
      {
        id: createId(),
        timestamp: new Date().toISOString(),
        mode: court.mode,
        matchType: court.matchType,
        courtNumber: court.courtNumber,
        teamAIds: court.teamAIds,
        teamBIds: court.teamBIds,
        winner,
      },
    ]);
    setGeneratedCourts((prev) =>
      prev.filter((c) => c.courtNumber !== court.courtNumber),
    );
    setSwapSource(null);
  };

  const getSlotId = (courts: GeneratedCourt[], s: SwapSource): string => {
    if (s.type === "rest") return s.id;
    const c = courts[s.courtIdx];
    const ids = s.team === "A" ? c.teamAIds : c.teamBIds;
    return ids[s.playerIdx] ?? "";
  };

  const setCourtSlot = (
    courts: GeneratedCourt[],
    courtIdx: number,
    team: "A" | "B",
    playerIdx: number,
    newId: string,
  ): GeneratedCourt[] => {
    return courts.map((c, i) => {
      if (i !== courtIdx) return c;
      if (team === "A") {
        const next = [...c.teamAIds];
        next[playerIdx] = newId;
        return { ...c, teamAIds: next };
      }
      const next = [...c.teamBIds];
      next[playerIdx] = newId;
      return { ...c, teamBIds: next };
    });
  };

  const handleSwap = (target: SwapSource) => {
    if (!swapSource) return;
    const source = swapSource;
    setSwapSource(null);

    if (source.type === "rest" && target.type === "rest") return;
    const id1 = getSlotId(generatedCourts, source);
    const id2 = getSlotId(generatedCourts, target);

    if (source.type === "court" && target.type === "court") {
      setGeneratedCourts((prev) => {
        let next = setCourtSlot(prev, source.courtIdx, source.team, source.playerIdx, id2);
        next = setCourtSlot(next, target.courtIdx, target.team, target.playerIdx, id1);
        return next;
      });
      return;
    }
    if (source.type === "court" && target.type === "rest") {
      setGeneratedCourts((prev) =>
        setCourtSlot(prev, source.courtIdx, source.team, source.playerIdx, id2),
      );
      return;
    }
    if (source.type === "rest" && target.type === "court") {
      setGeneratedCourts((prev) =>
        setCourtSlot(prev, target.courtIdx, target.team, target.playerIdx, id1),
      );
    }
  };

  const handleEditMatchWinner = (matchId: string, newWinner: WinnerSide) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, winner: newWinner } : m)),
    );
    setEditingMatchId(null);
  };

  const handleDeleteMatch = (matchId: string) => {
    if (typeof window !== "undefined" && !window.confirm("この試合を削除しますか？レート・勝率は再計算されます。")) return;
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    setEditingMatchId(null);
  };

  const handleUpdateCourtLabel = (courtNumber: number, label: string) => {
    setGeneratedCourts((prev) =>
      prev.map((c) =>
        c.courtNumber === courtNumber
          ? { ...c, courtLabel: label.trim() || undefined }
          : c,
      ),
    );
  };

  const handleToggleCourtMode = (courtNumber: number) => {
    setGeneratedCourts((prev) =>
      prev.map((c) =>
        c.courtNumber === courtNumber
          ? { ...c, mode: c.mode === "serious" ? "enjoy" : "serious" }
          : c,
      ),
    );
  };

  const memberStatsSorted = useMemo(
    () =>
      [...members]
        .map((m) => ({ ...m, ...getMemberStats(m.id) }))
        .sort((a, b) => {
          if (b.rating === a.rating) {
            return (
              calculateWinRate(b.wins, b.losses) -
              calculateWinRate(a.wins, a.losses)
            );
          }
          return b.rating - a.rating;
        }),
    [members, memberStatsMap],
  );

  const ratingHistoryByMember = useMemo(() => {
    const curRatings = new Map<string, number>();
    const history = new Map<string, { timestamp: string; rating: number }[]>();
    for (const m of members) {
      const r = m.initialRating ?? INITIAL_RATING;
      curRatings.set(m.id, r);
      history.set(m.id, [{ timestamp: "", rating: r }]);
    }
    const sortedMatches = [...matches].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (const match of sortedMatches) {
      const teamAIds = match.teamAIds;
      const teamBIds = match.teamBIds;
      const get = (id: string) => curRatings.get(id) ?? INITIAL_RATING;
      if (match.mode === "enjoy") {
        for (const id of [...teamAIds, ...teamBIds]) {
          history.get(id)?.push({
            timestamp: match.timestamp,
            rating: get(id),
          });
        }
        continue;
      }
      const ratingA =
        teamAIds.reduce((s, id) => s + get(id), 0) /
        Math.max(teamAIds.length, 1);
      const ratingB =
        teamBIds.reduce((s, id) => s + get(id), 0) /
        Math.max(teamBIds.length, 1);
      const expectedA = calculateExpectedScore(ratingA, ratingB);
      const scoreA = match.winner === "A" ? 1 : 0;
      const scoreB = match.winner === "B" ? 1 : 0;
      const deltaA = K_FACTOR * (scoreA - expectedA);
      const deltaB = K_FACTOR * (scoreB - (1 - expectedA));
      for (const id of teamAIds) {
        const next = Math.round(get(id) + deltaA);
        curRatings.set(id, next);
        history.get(id)?.push({ timestamp: match.timestamp, rating: next });
      }
      for (const id of teamBIds) {
        const next = Math.round(get(id) + deltaB);
        curRatings.set(id, next);
        history.get(id)?.push({ timestamp: match.timestamp, rating: next });
      }
    }
    return history;
  }, [members, matches]);

  const pairStats = useMemo(() => {
    type PairKey = string;
    type PairAgg = {
      pairKey: PairKey;
      memberIds: string[];
      wins: number;
      losses: number;
    };
    const map = new Map<PairKey, PairAgg>();

    for (const match of matches) {
      if (match.matchType !== "double") continue;

      const teamPairs = [match.teamAIds, match.teamBIds];

      teamPairs.forEach((teamIds, index) => {
        if (teamIds.length !== 2) return;
        const sortedIds = [...teamIds].sort();
        const key = sortedIds.join("-");
        const isWinner =
          (match.winner === "A" && index === 0) ||
          (match.winner === "B" && index === 1);

        const current = map.get(key) ?? {
          pairKey: key,
          memberIds: sortedIds,
          wins: 0,
          losses: 0,
        };
        if (isWinner) {
          current.wins += 1;
        } else {
          current.losses += 1;
        }
        map.set(key, current);
      });
    }

    const list = Array.from(map.values())
      .filter((p) => p.wins + p.losses >= 3) // 試合数が少なすぎるペアは除外
      .map((p) => ({
        ...p,
        winRate: calculateWinRate(p.wins, p.losses),
      }))
      .sort((a, b) => b.winRate - a.winRate);

    return list;
  }, [matches]);

  const bestPairsByMember = useMemo(() => {
    const map = new Map<
      string,
      { partnerId: string; wins: number; losses: number; winRate: number }[]
    >();
    for (const m of members) {
      map.set(m.id, []);
    }
    for (const p of pairStats) {
      const [id1, id2] = p.memberIds;
      const winRate = p.winRate;
      map.get(id1)?.push({
        partnerId: id2,
        wins: p.wins,
        losses: p.losses,
        winRate,
      });
      map.get(id2)?.push({
        partnerId: id1,
        wins: p.wins,
        losses: p.losses,
        winRate,
      });
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.winRate - a.winRate);
    }
    return map;
  }, [members, pairStats]);

  const findMemberName = (id: string) =>
    members.find((m) => m.id === id)?.name ?? "不明";

  const findMember = (id: string) => members.find((m) => m.id === id);

  const idsInCourts = useMemo(() => {
    const set = new Set<string>();
    for (const c of generatedCourts) {
      c.teamAIds.forEach((id) => set.add(id));
      c.teamBIds.forEach((id) => set.add(id));
    }
    return set;
  }, [generatedCourts]);

  const restMemberIds = useMemo(
    () => activeMembers.filter((m) => !idsInCourts.has(m.id)).map((m) => m.id),
    [activeMembers, idsInCourts],
  );

  const todayStr = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  );

  const todayMatches = useMemo(
    () =>
      matches.filter((m) => m.timestamp.slice(0, 10) === todayStr),
    [matches, todayStr],
  );

  const participationCountToday = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) {
      map.set(m.id, 0);
    }
    for (const match of todayMatches) {
      for (const id of [...match.teamAIds, ...match.teamBIds]) {
        map.set(id, (map.get(id) ?? 0) + 1);
      }
    }
    return map;
  }, [members, todayMatches]);

  const usedPairsToday = useMemo(() => {
    const set = new Set<string>();
    const pk = (a: string, b: string) => [a, b].sort().join("-");
    for (const match of todayMatches) {
      if (match.matchType === "double") {
        if (match.teamAIds.length === 2)
          set.add(pk(match.teamAIds[0], match.teamAIds[1]));
        if (match.teamBIds.length === 2)
          set.add(pk(match.teamBIds[0], match.teamBIds[1]));
      } else {
        if (match.teamAIds[0] && match.teamBIds[0])
          set.add(pk(match.teamAIds[0], match.teamBIds[0]));
      }
    }
    return set;
  }, [todayMatches]);

  /** その日にその二人で組んだ回数（試合履歴＋現在の生成コート） */
  const pairCountToday = useMemo(() => {
    const map = new Map<string, number>();
    const pk = (a: string, b: string) => [a, b].sort().join("-");
    const add = (id1: string, id2: string) => {
      const key = pk(id1, id2);
      map.set(key, (map.get(key) ?? 0) + 1);
    };
    for (const match of todayMatches) {
      if (match.matchType === "double") {
        if (match.teamAIds.length === 2) add(match.teamAIds[0], match.teamAIds[1]);
        if (match.teamBIds.length === 2) add(match.teamBIds[0], match.teamBIds[1]);
      }
    }
    for (const court of generatedCourts) {
      if (court.matchType === "double") {
        if (court.teamAIds.length === 2) add(court.teamAIds[0], court.teamAIds[1]);
        if (court.teamBIds.length === 2) add(court.teamBIds[0], court.teamBIds[1]);
      }
    }
    return map;
  }, [todayMatches, generatedCourts]);

  const matchesNewestFirst = useMemo(
    () =>
      [...matches].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [matches],
  );

  // データ読み込み中
  if (!dataLoaded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 text-gray-700">
        <p className="text-lg font-medium">読み込み中...</p>
      </div>
    );
  }

  // ペア表示タブ時は画面いっぱいの専用ビュー（iPad用・横画面で全コート一覧）
  if (selectedTab === "pairDisplay") {
    const courtCount = generatedCourts.length;
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-gray-100">
        <div className="flex min-h-0 flex-1 flex-col p-1">
          {generatedCourts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-gray-700">
              <p className="text-2xl font-medium md:text-4xl">
                ペアがまだ生成されていません
              </p>
              <p className="text-xl text-gray-600 md:text-2xl">
                「ペア生成」タブでペアを生成してください
              </p>
              <button
                type="button"
                onClick={() => setSelectedTab("pair")}
                className="rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold text-white shadow-md hover:bg-blue-700 md:text-2xl"
              >
                ペア生成へ
              </button>
            </div>
          ) : (
            <div
              className="grid min-h-0 flex-1 gap-1 w-full"
              style={{
                gridTemplateColumns:
                  courtCount === 1
                    ? "1fr"
                    : courtCount === 2
                      ? "1fr 1fr"
                      : courtCount === 3
                        ? "1fr 1fr 1fr"
                        : courtCount === 4
                          ? "1fr 1fr 1fr 1fr"
                          : "repeat(3, 1fr)",
              }}
            >
              {generatedCourts.map((court) => {
                const typeLabel =
                  court.matchType === "single" ? "シングルス" : "ダブルス";
                const modeLabel =
                  court.mode === "serious" ? "ガチマッチ" : "エンジョイマッチ";
                return (
                  <div
                    key={court.courtNumber}
                    className="flex min-h-0 flex-col rounded-lg bg-white p-2 shadow ring-1 ring-gray-200"
                  >
                    <div className="mb-1 flex shrink-0 flex-wrap items-center justify-center gap-1">
                      <input
                        type="text"
                        value={court.courtLabel ?? ""}
                        onChange={(e) =>
                          handleUpdateCourtLabel(
                            court.courtNumber,
                            e.target.value,
                          )
                        }
                        placeholder={String(court.courtNumber)}
                        className="w-16 rounded border border-gray-300 px-1 py-0.5 text-lg font-bold text-gray-900 md:w-20"
                        aria-label="コート名"
                      />
                      <span className="text-lg font-bold text-gray-900">
                        コート
                      </span>
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-800">
                        {typeLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`mb-1 w-full rounded px-2 py-0.5 text-center text-xs font-semibold ${
                        court.mode === "serious"
                          ? "bg-blue-50 text-blue-800"
                          : "bg-orange-50 text-orange-800"
                      }`}
                      onClick={() => handleToggleCourtMode(court.courtNumber)}
                      title="タップでガチ⇔エンジョイを切り替え"
                    >
                      {modeLabel}
                    </button>
                    <div
                      className="flex min-h-0 flex-1 flex-col justify-center gap-0 overflow-hidden"
                      style={{ minHeight: 0 }}
                    >
                      <div className="flex min-h-0 flex-1 flex-col justify-center items-center rounded bg-gray-50 px-2 py-0.5 overflow-hidden gap-0">
                        <div className="shrink-0 mb-0.5 text-[10px] font-bold text-gray-600 leading-none w-full text-center">
                          チームA
                        </div>
                        {court.teamAIds.map((id) => {
                          const member = findMember(id);
                          const isMale = member?.gender === "male";
                          const isFemale = member?.gender === "female";
                          const colorClass = isMale ? "text-blue-600" : isFemale ? "text-red-600" : "text-gray-900";
                          return (
                            <div
                              key={id}
                              className={`leading-none font-bold w-full text-center flex items-center justify-center min-h-0 flex-1 overflow-hidden ${colorClass}`}
                              style={{
                                fontSize: "min(14vh, 14vw)",
                                maxHeight: "50%",
                              }}
                            >
                              <span className="block max-w-full break-words line-clamp-2 text-ellipsis" style={{ wordBreak: "break-word" }}>
                                {member?.isBeginner && "🔰 "}
                                {findMemberName(id)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div
                        className="shrink-0 py-0 text-center font-bold text-gray-500 leading-none"
                        style={{ fontSize: "min(3vh, 3vw)" }}
                      >
                        VS
                      </div>
                      <div className="flex min-h-0 flex-1 flex-col justify-center items-center rounded bg-gray-50 px-2 py-0.5 overflow-hidden gap-0">
                        <div className="shrink-0 mb-0.5 text-[10px] font-bold text-gray-600 leading-none w-full text-center">
                          チームB
                        </div>
                        {court.teamBIds.map((id) => {
                          const member = findMember(id);
                          const isMale = member?.gender === "male";
                          const isFemale = member?.gender === "female";
                          const colorClass = isMale ? "text-blue-600" : isFemale ? "text-red-600" : "text-gray-900";
                          return (
                            <div
                              key={id}
                              className={`leading-none font-bold w-full text-center flex items-center justify-center min-h-0 flex-1 overflow-hidden ${colorClass}`}
                              style={{
                                fontSize: "min(14vh, 14vw)",
                                maxHeight: "50%",
                              }}
                            >
                              <span className="block max-w-full break-words line-clamp-2 text-ellipsis" style={{ wordBreak: "break-word" }}>
                                {member?.isBeginner && "🔰 "}
                                {findMemberName(id)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="shrink-0 p-2">
          <button
            type="button"
            onClick={() => setSelectedTab("pair")}
            className="w-full rounded-lg bg-gray-700 py-2.5 text-base font-semibold text-white hover:bg-gray-800"
          >
            管理画面に戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white px-4 py-3 shadow-sm md:px-6 md:py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">
              バドミントンサークル マッチ管理
            </h1>
            <p className="text-sm text-gray-600 md:text-base">
              参加者管理・ペア生成・レート(ELO)・勝率を1画面で。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-gray-200 px-3 py-1.5 font-medium text-gray-800">
              登録メンバー: {members.length}人
            </span>
            <span className="rounded-full bg-green-100 px-3 py-1.5 font-medium text-green-800">
              今日の参加者: {activeMembers.length}人
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4 md:py-6">
        {/* タブ */}
        <div className="flex flex-wrap gap-2 rounded-xl bg-gray-200 p-1.5 text-sm md:text-base">
          <button
            type="button"
            onClick={() => setSelectedTab("members")}
            className={`rounded-lg px-3 py-2 font-medium ${
              selectedTab === "members"
                ? "bg-white text-gray-900 shadow"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            メンバー
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("pair")}
            className={`rounded-lg px-3 py-2 font-medium ${
              selectedTab === "pair"
                ? "bg-white text-gray-900 shadow"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            ペア生成
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("pairDisplay")}
            className="rounded-lg px-3 py-2 font-medium text-gray-700 hover:bg-gray-100"
          >
            ペア表示
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("history")}
            className={`rounded-lg px-3 py-2 font-medium ${
              selectedTab === "history"
                ? "bg-white text-gray-900 shadow"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            試合履歴
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("stats")}
            className={`rounded-lg px-3 py-2 font-medium ${
              selectedTab === "stats"
                ? "bg-white text-gray-900 shadow"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            成績・勝率
          </button>
        </div>

        {/* コンテンツ */}
        <section className="flex-1 overflow-hidden rounded-2xl bg-white p-4 shadow-md md:p-6">
          {selectedTab === "members" && (
            <div className="flex h-full flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-1 flex-col gap-2">
                  <label className="text-sm font-medium text-gray-800">
                    メンバー追加
                    <span className="ml-1 text-xs text-gray-600">
                      （名前だけでOK）
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="例: 田中"
                      className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                    />
                    <button
                      type="button"
                      onClick={handleAddMember}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      追加
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={handleResetToday}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50"
                  >
                    今日の参加フラグを全員オフ
                  </button>
                </div>
              </div>

              <div className="mt-2 flex-1 overflow-auto rounded-xl border border-gray-200 bg-gray-50">
                {members.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-sm text-gray-600">
                    まだメンバーが登録されていません。上のフォームから追加してください。
                  </div>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-700">
                      <tr>
                        <th className="px-3 py-2">今日参加</th>
                        <th className="px-3 py-2">管理者</th>
                        <th className="px-3 py-2">名前</th>
                        <th className="px-3 py-2">性別</th>
                        <th className="px-3 py-2">初心者</th>
                        <th className="px-3 py-2">レート</th>
                        <th className="px-3 py-2">戦績</th>
                        <th className="px-3 py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => {
                        const st = getMemberStats(m.id);
                        const isEditing = editingMemberId === m.id;
                        return (
                          <tr
                            key={m.id}
                            className="border-t border-gray-200 text-gray-900"
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={m.activeToday}
                                onChange={() => toggleActiveToday(m.id)}
                                className="h-4 w-4"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={m.isAdmin ?? false}
                                onChange={() => toggleAdmin(m.id)}
                                className="h-4 w-4"
                                title="管理者にすると毎試合最低1名が休憩になるよう優先されます"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editMemberNameValue}
                                  onChange={(e) =>
                                    setEditMemberNameValue(e.target.value)}
                                  className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
                                  autoFocus
                                />
                              ) : (
                                <div className="flex flex-col">
                                  <span className="font-medium">{m.name}</span>
                                  {m.activeToday && (
                                    <span className="text-xs font-medium text-green-700">
                                      今日参加
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={m.gender ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value as "" | "male" | "female";
                                  if (v) setMemberGender(m.id, v);
                                }}
                                className="rounded border border-gray-300 px-1.5 py-0.5 text-sm"
                              >
                                <option value="">—</option>
                                <option value="male">男</option>
                                <option value="female">女</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={m.isBeginner ?? false}
                                onChange={() => toggleBeginner(m.id)}
                                className="h-4 w-4"
                                title="初心者"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    max={3000}
                                    value={editMemberRatingValue}
                                    onChange={(e) =>
                                      setEditMemberRatingValue(e.target.value)}
                                    className="w-20 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
                                  />
                                  <span className="text-xs text-gray-600">
                                    （初期）
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <span className="font-mono font-semibold">
                                    {st.rating}
                                  </span>
                                  <span className="ml-1 text-xs text-gray-600">
                                    ({st.rating - INITIAL_RATING >= 0 ? "+" : ""}
                                    {st.rating - INITIAL_RATING})
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-800">
                              <div className="font-medium text-gray-900">
                                ガチ {st.seriousWins}勝{st.seriousLosses}敗
                                {(st.seriousWins + st.seriousLosses) > 0 && (
                                  <span className="ml-1 text-xs text-gray-600">
                                    ({calculateWinRate(st.seriousWins, st.seriousLosses).toFixed(0)}%)
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-700">
                                エンジョイ {st.enjoyWins}勝{st.enjoyLosses}敗
                                {(st.enjoyWins + st.enjoyLosses) > 0 && (
                                  <span className="ml-1 text-xs text-gray-600">
                                    ({calculateWinRate(st.enjoyWins, st.enjoyLosses).toFixed(0)}%)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleUpdateMemberName(m.id, editMemberNameValue);
                                      const r = parseInt(
                                        editMemberRatingValue,
                                        10,
                                      );
                                      if (!Number.isNaN(r))
                                        handleUpdateMemberInitialRating(m.id, r);
                                      setEditingMemberId(null);
                                    }}
                                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                  >
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMemberId(null);
                                    }}
                                    className="rounded bg-gray-400 px-2 py-1 text-xs font-medium text-white hover:bg-gray-500"
                                  >
                                    キャンセル
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMemberId(m.id);
                                      setEditMemberNameValue(m.name);
                                      setEditMemberRatingValue(
                                        String(m.initialRating ?? INITIAL_RATING),
                                      );
                                    }}
                                    className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-300"
                                  >
                                    編集
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMember(m.id)}
                                    className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                                  >
                                    削除
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {selectedTab === "pair" && (
            <div className="flex h-full flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-1 flex-wrap gap-3 text-sm">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700">
                      マッチタイプ
                    </span>
                    <div className="mt-1 inline-flex rounded-full bg-gray-200 p-1">
                      <button
                        type="button"
                        onClick={() => setMatchMode("serious")}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          matchMode === "serious"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-gray-800 hover:bg-gray-100"
                        }`}
                      >
                        ガチマッチ
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatchMode("enjoy")}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          matchMode === "enjoy"
                            ? "bg-orange-500 text-white shadow-sm"
                            : "text-gray-800 hover:bg-gray-100"
                        }`}
                      >
                        エンジョイマッチ
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700">
                      形式
                    </span>
                    <div className="mt-1 inline-flex rounded-full bg-gray-200 p-1">
                      <button
                        type="button"
                        onClick={() => setMatchType("single")}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          matchType === "single"
                            ? "bg-gray-800 text-white shadow-sm"
                            : "text-gray-800 hover:bg-gray-100"
                        }`}
                      >
                        シングルス
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatchType("double")}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          matchType === "double"
                            ? "bg-gray-800 text-white shadow-sm"
                            : "text-gray-800 hover:bg-gray-100"
                        }`}
                      >
                        ダブルス
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-gray-700">
                      コート数
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={courtCount}
                        onChange={(e) =>
                          setCourtCount(Number(e.target.value))
                        }
                        className="text-gray-700"
                      />
                      <span className="w-10 text-center text-sm font-mono font-semibold text-gray-900">
                        {courtCount}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 text-sm">
                  <div className="font-medium text-gray-700">
                    今日の参加者 {activeMembers.length}人
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleGeneratePairs}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      ペアを生成する
                    </button>
                    {generatedCourts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedTab("pairDisplay")}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        iPadで表示
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                  {errorMessage}
                </div>
              )}

              {generatedCourts.length > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-semibold">メンバー入れ替え:</span> 名前をクリックしてから、別の名前（または休憩の人）をクリックすると入れ替わります。
                  {swapSource && (
                    <button
                      type="button"
                      onClick={() => setSwapSource(null)}
                      className="ml-2 rounded bg-amber-200 px-2 py-0.5 text-xs font-medium hover:bg-amber-300"
                    >
                      キャンセル
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-1 gap-3 overflow-auto">
                <div className="flex-1 rounded-xl border border-gray-200 bg-gray-50 p-3 md:p-4">
                  {generatedCourts.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-gray-600">
                      ペアがまだ生成されていません。「ペアを生成する」ボタンを押してください。
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {generatedCourts.map((court, courtIdx) => {
                        const title =
                          court.matchType === "single"
                            ? "シングルス"
                            : "ダブルス";
                        const modeLabel =
                          court.mode === "serious"
                            ? "ガチマッチ"
                            : "エンジョイマッチ";

                        const isSelected = (team: "A" | "B", playerIdx: number) =>
                          swapSource?.type === "court" &&
                          swapSource.courtIdx === courtIdx &&
                          swapSource.team === team &&
                          swapSource.playerIdx === playerIdx;

                        return (
                          <div
                            key={court.courtNumber}
                            className="flex flex-col justify-between rounded-2xl bg-white px-4 py-3 shadow-md ring-1 ring-gray-200"
                          >
                            <div className="mb-2 flex items-baseline justify-between">
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                                  コート{court.courtNumber}
                                </span>
                                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-800">
                                  {title}
                                </span>
                              </div>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold cursor-pointer hover:opacity-90 ${
                                  court.mode === "serious"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-orange-100 text-orange-800"
                                }`}
                                onClick={() => handleToggleCourtMode(court.courtNumber)}
                                title="クリックでガチ⇔エンジョイを切り替え"
                              >
                                {modeLabel}
                              </span>
                            </div>

                            <div className="flex flex-col gap-2 text-sm text-gray-900">
                              <div className="rounded-xl bg-gray-100 px-3 py-2">
                                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-gray-700">
                                  <span>チームA</span>
                                  <span className="flex items-center gap-1.5">
                                    {court.matchType === "double" && court.teamAIds.length === 2 && (
                                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                                        今日{pairCountToday.get(pairKey(court.teamAIds[0], court.teamAIds[1])) ?? 1}回目
                                      </span>
                                    )}
                                    <span className="font-mono text-gray-600">
                                      平均 {court.teamAIds.length > 0
                                        ? Math.round(
                                            court.teamAIds.reduce(
                                              (s, id) => s + getMemberStats(id).rating,
                                              0,
                                            ) / court.teamAIds.length,
                                          )
                                        : "-"}
                                    </span>
                                  </span>
                                </div>
                                {court.teamAIds.map((id, playerIdx) => (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                      const slot: SwapSource = {
                                        type: "court",
                                        courtIdx,
                                        team: "A",
                                        playerIdx,
                                      };
                                      if (swapSource) handleSwap(slot);
                                      else setSwapSource(slot);
                                    }}
                                    className={`block w-full rounded px-1 py-0.5 text-left font-medium hover:bg-gray-200 ${
                                      isSelected("A", playerIdx)
                                        ? "ring-2 ring-blue-500 bg-blue-100"
                                        : ""
                                    }`}
                                  >
                                    {findMemberName(id)} {getMemberStats(id).rating}
                                    ({participationCountToday.get(id) ?? 0})
                                  </button>
                                ))}
                              </div>

                              <div className="text-center text-xs font-bold text-gray-600">
                                VS
                              </div>

                              <div className="rounded-xl bg-gray-100 px-3 py-2">
                                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-gray-700">
                                  <span>チームB</span>
                                  <span className="flex items-center gap-1.5">
                                    {court.matchType === "double" && court.teamBIds.length === 2 && (
                                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                                        今日{pairCountToday.get(pairKey(court.teamBIds[0], court.teamBIds[1])) ?? 1}回目
                                      </span>
                                    )}
                                    <span className="font-mono text-gray-600">
                                      平均 {court.teamBIds.length > 0
                                        ? Math.round(
                                            court.teamBIds.reduce(
                                              (s, id) => s + getMemberStats(id).rating,
                                              0,
                                            ) / court.teamBIds.length,
                                          )
                                        : "-"}
                                    </span>
                                  </span>
                                </div>
                                {court.teamBIds.map((id, playerIdx) => (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                      const slot: SwapSource = {
                                        type: "court",
                                        courtIdx,
                                        team: "B",
                                        playerIdx,
                                      };
                                      if (swapSource) handleSwap(slot);
                                      else setSwapSource(slot);
                                    }}
                                    className={`block w-full rounded px-1 py-0.5 text-left font-medium hover:bg-gray-200 ${
                                      isSelected("B", playerIdx)
                                        ? "ring-2 ring-blue-500 bg-blue-100"
                                        : ""
                                    }`}
                                  >
                                    {findMemberName(id)} {getMemberStats(id).rating}
                                    ({participationCountToday.get(id) ?? 0})
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="mt-3 flex justify-end gap-2 text-xs">
                              <span className="self-center font-medium text-gray-700">
                                結果入力:
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRecordResult(court, "A")}
                                className="rounded-full bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
                              >
                                A勝ち
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRecordResult(court, "B")}
                                className="rounded-full bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
                              >
                                B勝ち
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {generatedCourts.length > 0 && restMemberIds.length > 0 && (
                  <div className="min-w-[7rem] shrink-0 rounded-xl border border-gray-200 bg-amber-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-amber-900">
                      休憩
                    </div>
                    <div className="flex flex-col gap-1">
                      {restMemberIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            const slot: SwapSource = { type: "rest", id };
                            if (swapSource) handleSwap(slot);
                            else setSwapSource(slot);
                          }}
                          className={`rounded px-2 py-1 text-left text-sm font-medium hover:bg-amber-100 ${
                            swapSource?.type === "rest" && swapSource.id === id
                              ? "ring-2 ring-amber-500 bg-amber-200"
                              : ""
                          }`}
                        >
                          {findMemberName(id)} {getMemberStats(id).rating}
                          ({(participationCountToday.get(id) ?? 0)})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedTab === "history" && (
            <div className="flex h-full flex-col gap-4">
              <h2 className="text-lg font-semibold text-gray-900">
                試合履歴（新しい順）
              </h2>
              <p className="text-sm text-gray-600">
                間違った場合は「修正」で勝者を変更、「削除」で試合を削除できます。ガチマッチのみレート変動し、エンジョイは勝敗のみ記録されます。
              </p>
              <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-gray-50">
                {matchesNewestFirst.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-sm text-gray-600">
                    まだ試合履歴がありません。
                  </div>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-gray-100 font-semibold text-gray-800">
                      <tr>
                        <th className="px-3 py-2">日時</th>
                        <th className="px-3 py-2">コート</th>
                        <th className="px-3 py-2">種別</th>
                        <th className="px-3 py-2">対戦</th>
                        <th className="px-3 py-2">勝者</th>
                        <th className="px-3 py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchesNewestFirst.map((match) => {
                        const isEditing = editingMatchId === match.id;
                        const modeLabel =
                          match.mode === "serious" ? "ガチ" : "エンジョイ";
                        const typeLabel =
                          match.matchType === "single" ? "シングル" : "ダブル";
                        const teamANames = match.teamAIds
                          .map((id) => findMemberName(id))
                          .join(" / ");
                        const teamBNames = match.teamBIds
                          .map((id) => findMemberName(id))
                          .join(" / ");
                        const dateStr = new Date(match.timestamp).toLocaleString(
                          "ja-JP",
                          {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        );
                        return (
                          <tr
                            key={match.id}
                            className="border-t border-gray-200 text-gray-900"
                          >
                            <td className="px-3 py-2 text-gray-700">
                              {dateStr}
                            </td>
                            <td className="px-3 py-2 font-medium">
                              {match.courtNumber}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {modeLabel}・{typeLabel}
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-medium">A:</span>{" "}
                              {teamANames}
                              <span className="mx-1 text-gray-500">vs</span>
                              <span className="font-medium">B:</span>{" "}
                              {teamBNames}
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <span className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleEditMatchWinner(match.id, "A")
                                    }
                                    className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                                  >
                                    Aに変更
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleEditMatchWinner(match.id, "B")
                                    }
                                    className="rounded bg-orange-600 px-2 py-1 text-xs font-semibold text-white hover:bg-orange-700"
                                  >
                                    Bに変更
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingMatchId(null)}
                                    className="rounded bg-gray-500 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-600"
                                  >
                                    キャンセル
                                  </button>
                                </span>
                              ) : (
                                <span className="font-semibold">
                                  {match.winner === "A" ? "A" : "B"}勝ち
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {!isEditing && (
                                <span className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setEditingMatchId(match.id)}
                                    className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-300"
                                  >
                                    修正
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMatch(match.id)}
                                    className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                                  >
                                    削除
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {selectedTab === "stats" && (
            <div className="flex h-full flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
                  <div className="text-xs font-semibold text-gray-700">
                    登録メンバー
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">
                    {members.length}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
                  <div className="text-xs font-semibold text-gray-700">
                    累計試合数
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">
                    {matches.length}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
                  <div className="text-xs font-semibold text-gray-700">
                    ダブルスのペア数
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">
                    {pairStats.length}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-800">
                  レート推移（ELO）
                </h3>
                <div className="mb-2">
                  <select
                    value={chartMemberId}
                    onChange={(e) => setChartMemberId(e.target.value)}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">メンバーを選択</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}（現在 {getMemberStats(m.id).rating}）
                      </option>
                    ))}
                  </select>
                </div>
                {chartMemberId && (() => {
                  const points = ratingHistoryByMember.get(chartMemberId) ?? [];
                  const validPoints = points.filter((p) => p.timestamp);
                  if (validPoints.length === 0) {
                    return (
                      <p className="text-sm text-gray-500">
                        まだ試合履歴がありません。
                      </p>
                    );
                  }
                  const ratings = validPoints.map((p) => p.rating);
                  const minR = Math.min(...ratings, getMemberStats(chartMemberId).rating);
                  const maxR = Math.max(...ratings, getMemberStats(chartMemberId).rating);
                  const padding = Math.max(20, (maxR - minR) * 0.1) || 40;
                  const minY = minR - padding;
                  const maxY = maxR + padding;
                  const w = 600;
                  const h = 220;
                  const toX = (i: number) => (i / Math.max(validPoints.length - 1, 1)) * (w - 40) + 20;
                  const toY = (r: number) => h - 30 - ((r - minY) / (maxY - minY)) * (h - 50);
                  const pathD = validPoints
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(p.rating)}`)
                    .join(" ");
                  return (
                    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-full" preserveAspectRatio="xMidYMid meet">
                      <line x1={20} y1={h - 30} x2={w - 20} y2={h - 30} stroke="#e5e7eb" strokeWidth={1} />
                      <line x1={20} y1={20} x2={20} y2={h - 30} stroke="#e5e7eb" strokeWidth={1} />
                      <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      {validPoints.map((p, i) => (
                        <circle key={i} cx={toX(i)} cy={toY(p.rating)} r={4} fill="#2563eb" />
                      ))}
                      <text x={20} y={15} className="text-[10px] fill-gray-500" fontWeight="500">
                        {maxY}
                      </text>
                      <text x={20} y={h - 12} className="text-[10px] fill-gray-500" fontWeight="500">
                        {minY}
                      </text>
                    </svg>
                  );
                })()}
              </div>

              <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">
                    <span>個人成績（レート順）</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {memberStatsSorted.length === 0 ? (
                      <div className="flex h-32 items-center justify-center text-sm text-gray-600">
                        メンバーが登録されていません。
                      </div>
                    ) : (
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 bg-gray-100 font-semibold text-gray-700">
                          <tr>
                            <th className="px-3 py-2">名前</th>
                            <th className="px-3 py-2">レート</th>
                            <th className="px-3 py-2">ガチ</th>
                            <th className="px-3 py-2">エンジョイ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberStatsSorted.map((m) => (
                            <tr
                              key={m.id}
                              className="border-t border-gray-200 text-gray-900"
                            >
                              <td className="px-3 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => setStatsDetailMemberId(m.id)}
                                  className="font-medium text-blue-700 underline decoration-blue-700/50 underline-offset-2 hover:decoration-blue-700"
                                >
                                  {m.name}
                                </button>
                              </td>
                              <td className="px-3 py-1.5 font-mono font-semibold">
                                {m.rating}
                              </td>
                              <td className="px-3 py-1.5 text-gray-800">
                                {m.seriousWins}勝{m.seriousLosses}敗
                                {(m.seriousWins + m.seriousLosses) > 0 && (
                                  <span className="text-gray-600">
                                    {" "}
                                    {calculateWinRate(m.seriousWins, m.seriousLosses).toFixed(0)}%
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-gray-800">
                                {m.enjoyWins}勝{m.enjoyLosses}敗
                                {(m.enjoyWins + m.enjoyLosses) > 0 && (
                                  <span className="text-gray-600">
                                    {" "}
                                    {calculateWinRate(m.enjoyWins, m.enjoyLosses).toFixed(0)}%
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">
                    <span>勝率の高いペア（ダブルス）</span>
                    <span className="text-xs text-gray-600">
                      3試合以上のペアのみ表示
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {pairStats.length === 0 ? (
                      <div className="flex h-32 items-center justify-center text-sm text-gray-600">
                        まだ集計できるダブルスペアがありません。
                      </div>
                    ) : (
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 bg-gray-100 font-semibold text-gray-700">
                          <tr>
                            <th className="px-3 py-2">ペア</th>
                            <th className="px-3 py-2">試合数</th>
                            <th className="px-3 py-2">戦績</th>
                            <th className="px-3 py-2">勝率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pairStats.map((p) => (
                            <tr
                              key={p.pairKey}
                              className="border-t border-gray-200 text-gray-900"
                            >
                              <td className="px-3 py-1.5 font-medium">
                                {p.memberIds
                                  .map((id) => findMemberName(id))
                                  .join(" & ")}
                              </td>
                              <td className="px-3 py-1.5 text-gray-800">
                                {p.wins + p.losses}
                              </td>
                              <td className="px-3 py-1.5 text-gray-800">
                                {p.wins}勝 {p.losses}敗
                              </td>
                              <td className="px-3 py-1.5 font-medium text-gray-800">
                                {p.winRate.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {statsDetailMemberId && (() => {
        const member = members.find((m) => m.id === statsDetailMemberId);
        if (!member) return null;
        const points = ratingHistoryByMember.get(statsDetailMemberId) ?? [];
        const validPoints = points.filter((p) => p.timestamp);
        const pairs = bestPairsByMember.get(statsDetailMemberId) ?? [];
        const recentMatches = matchesNewestFirst
                          .filter(
                            (m) =>
                              m.teamAIds.includes(statsDetailMemberId) ||
                              m.teamBIds.includes(statsDetailMemberId),
                          )
                          .slice(0, 10);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setStatsDetailMemberId(null)}
            role="dialog"
            aria-modal="true"
            aria-label="個人詳細"
          >
            <div
              className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  {member.name} の詳細
                </h2>
                <button
                  type="button"
                  onClick={() => setStatsDetailMemberId(null)}
                  className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                  aria-label="閉じる"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-800">
                    ELOレート推移
                  </h3>
                  {validPoints.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      まだ試合履歴がありません。
                    </p>
                  ) : (
                    (() => {
                      const ratings = validPoints.map((p) => p.rating);
                      const minR = Math.min(...ratings);
                      const maxR = Math.max(...ratings);
                      const padding = Math.max(20, (maxR - minR) * 0.1) || 40;
                      const minY = minR - padding;
                      const maxY = maxR + padding;
                      const w = 400;
                      const h = 180;
                      const toX = (i: number) =>
                        (i / Math.max(validPoints.length - 1, 1)) * (w - 40) + 20;
                      const toY = (r: number) =>
                        h - 30 - ((r - minY) / (maxY - minY)) * (h - 50);
                      const pathD = validPoints
                        .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(p.rating)}`)
                        .join(" ");
                      return (
                        <svg
                          viewBox={`0 0 ${w} ${h}`}
                          className="w-full max-w-full"
                          preserveAspectRatio="xMidYMid meet"
                        >
                          <line x1={20} y1={h - 30} x2={w - 20} y2={h - 30} stroke="#e5e7eb" strokeWidth={1} />
                          <line x1={20} y1={20} x2={20} y2={h - 30} stroke="#e5e7eb" strokeWidth={1} />
                          <path
                            d={pathD}
                            fill="none"
                            stroke="#2563eb"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {validPoints.map((p, i) => (
                            <circle key={i} cx={toX(i)} cy={toY(p.rating)} r={3} fill="#2563eb" />
                          ))}
                        </svg>
                      );
                    })()
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-800">
                    相性の良いペア（3試合以上）
                  </h3>
                  {pairs.length === 0 ? (
                    <p className="text-sm text-gray-500">まだデータがありません</p>
                  ) : (
                    <ul className="list-inside list-disc text-sm text-gray-700">
                      {pairs.slice(0, 5).map((pair) => (
                        <li key={pair.partnerId}>
                          {findMemberName(pair.partnerId)} — {pair.wins}勝{pair.losses}敗（勝率 {pair.winRate.toFixed(0)}%）
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-800">
                    直近の試合履歴
                  </h3>
                  {recentMatches.length === 0 ? (
                    <p className="text-sm text-gray-500">まだ試合がありません</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm text-gray-700">
                      {recentMatches.map((match) => {
                        const isA = match.teamAIds.includes(statsDetailMemberId);
                        const won = (match.winner === "A" && isA) || (match.winner === "B" && !isA);
                        const dateStr = new Date(match.timestamp).toLocaleString("ja-JP", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        const vs = isA
                          ? match.teamBIds.map((id) => findMemberName(id)).join(" / ")
                          : match.teamAIds.map((id) => findMemberName(id)).join(" / ");
                        const modeLabel = match.mode === "serious" ? "ガチ" : "エンジョイ";
                        return (
                          <li key={match.id} className="flex flex-wrap items-center gap-1 rounded bg-gray-50 px-2 py-1">
                            <span className="text-gray-500">{dateStr}</span>
                            <span className={won ? "font-medium text-green-700" : "text-red-600"}>
                              {won ? "勝" : "敗"}
                            </span>
                            <span className="text-gray-600">vs {vs}</span>
                            <span className="text-gray-400">({modeLabel})</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
