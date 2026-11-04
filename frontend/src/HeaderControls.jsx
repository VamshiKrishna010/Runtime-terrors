import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { Bell, RefreshCw } from 'lucide-react';
import { api } from '../convex/_generated/api';
import { useAuth } from './AuthGate';

const SEEN_KEY = 'veripulse.notifications-seen.v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function readSeenAt() {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}
function markSeen() {
  const now = Date.now();
  try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* storage blocked */ }
  return now;
}

/** Recent real activity from the live incident feed (shares the list subscription). */
export function incidentNotifications(incidents, now = Date.now()) {
  return (incidents || [])
    .filter((incident) => now - (incident.updatedAt ?? incident.createdAt) <= DAY_MS)
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, 5)
    .map((incident) => ({
      id: incident._id,
      at: incident.updatedAt ?? incident.createdAt,
      message: (incident.reportCount ?? 0) <= 1 && !incident.confirmations && !incident.contradictions
        ? `New incident reported at ${incident.location}: ${incident.title}`
        : `${incident.title} is ${incident.evidenceLevel} (${incident.supportScore}/100, ${incident.reportCount ?? 0} reports)`,
    }));
}

function useIncidentNotifications() {
  const incidents = useQuery(api.incidents.list);
  return useMemo(() => incidentNotifications(incidents), [incidents]);
}

export default function HeaderControls({ refresh, loading, refreshLabel = 'incidents' }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const controlsRef = useRef(null);
  const bellRef = useRef(null);
  const profileRef = useRef(null);
  const panelRef = useRef(null);
  const refreshPending = useRef(false);
  const notifications = useIncidentNotifications();
  const [seenAt, setSeenAt] = useState(readSeenAt);
  const unread = notifications.some((notification) => notification.at > seenAt);
  const role = import.meta.env.VITE_UI_ROLE;
  const branch = import.meta.env.VITE_GIT_BRANCH;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const closeOutside = (event) => {
      if (!controlsRef.current?.contains(event.target)) setOpen(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(null);
        (open === 'notifications' ? bellRef : profileRef).current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const handleRefresh = async () => {
    if (loading || refreshPending.current) return;
    refreshPending.current = true;
    try {
      await refresh();
    } finally {
      refreshPending.current = false;
    }
  };

  return (
    <div className="headerActions" ref={controlsRef}>
      <button type="button" className="iconButton" onClick={handleRefresh}
        disabled={loading} aria-busy={loading}
        aria-label={loading ? `Refreshing ${refreshLabel}` : `Refresh ${refreshLabel}`}>
        <RefreshCw size={18} className={loading ? 'spin' : undefined} aria-hidden="true" />
      </button>
      <div className="headerPopoverAnchor">
        <button type="button" className="iconButton notificationButton" ref={bellRef}
          aria-label={unread ? 'Notifications, unread notifications' : 'Notifications'}
          aria-expanded={open === 'notifications'} aria-controls="header-notifications"
          onClick={() => {
            if (open !== 'notifications') setSeenAt(markSeen());
            setOpen(open === 'notifications' ? null : 'notifications');
          }}>
          <Bell size={18} aria-hidden="true" />
          {unread && <span className="notificationDot" aria-hidden="true" />}
        </button>
        {open === 'notifications' && (
          <section id="header-notifications" className="headerPopover" ref={panelRef}
            tabIndex={-1} aria-labelledby="notifications-title">
            <b id="notifications-title">Notifications</b>
            {notifications.length ? (
              <ul className="notificationList">
                {notifications.map((notification) => <li key={notification.id}>{notification.message}</li>)}
              </ul>
            ) : <p className="headerPopoverNote">No new notifications</p>}
          </section>
        )}
      </div>
      <div className="headerPopoverAnchor">
        <button type="button" className="profile" ref={profileRef}
          aria-label="Runtime Terrors profile" aria-expanded={open === 'profile'}
          aria-controls="header-profile" onClick={() => {
            setNotice('');
            setOpen(open === 'profile' ? null : 'profile');
          }}>
          <span className="avatar">{user.initials}</span>
          <span><b>{user.name}</b><small>{user.event} / Demo</small></span>
        </button>
        {open === 'profile' && (
          <section id="header-profile" className="headerPopover" ref={panelRef}
            tabIndex={-1} aria-label="Team profile">
            <p>Account: {user.email}</p><p>Demo session</p>
            <p>Team: <b>{user.team}</b></p>
            <p>Event: <b>HackUMBC</b></p>
            {role && <p>UI role: {role}</p>}
            {branch && <p>Branch: {branch}</p>}
            <button type="button" className="headerPopoverAction"
              onClick={() => setNotice('Settings are coming soon.')}>Settings</button>
            <button type="button" className="headerPopoverAction"
              onClick={signOut}>Sign out</button>
            <output className="headerPopoverNote">{notice}</output>
          </section>
        )}
      </div>
    </div>
  );
}
