import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { shortAddr } from "../lib/format";

const cache = new Map();

/**
 * Shows profile name if available, else short address.
 */
export default function CreatorChip({ address, className = "" }) {
  const [profile, setProfile] = useState(() => cache.get(address) || null);

  useEffect(() => {
    if (!address || !/^g1/i.test(address)) return;
    if (cache.has(address)) {
      setProfile(cache.get(address));
      return;
    }
    let cancelled = false;
    api(`/api/profile?address=${encodeURIComponent(address)}`)
      .then((r) => {
        const p = r?.profile || null;
        cache.set(address, p);
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        cache.set(address, null);
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) return <span className={className}>—</span>;

  const label = profile?.name?.trim() || shortAddr(address);
  return (
    <Link
      to={`/profile?addr=${encodeURIComponent(address)}`}
      className={`creator-chip ${className}`.trim()}
      title={address}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}
