"""Read-only analytics: five bulk SELECTs, no per-incident database queries.

Range selects incidents by creation time. Reports/uploads must also fall in the
window. Votes and scores are current lifetime state for that cohort; legacy vote
counters cannot support a historical event series. All bucket boundaries are UTC.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from sqlmodel import select
from .models import Incident, Report
from .services import all_evidence, incident_payload, summary
from .evidence import utc, iso

CATEGORIES = ['Network / IT', 'Facilities', 'Environmental', 'Safety', 'Other']
LEVELS = ['Low', 'Emerging', 'Strong']


def aggregate_analytics(session, range='all', category=None, evidence_level=None, location=None, now=None):
    now = utc(now or datetime.now(timezone.utc))
    days = {'24h': 1, '7d': 7, '30d': 30}
    start = now - timedelta(days=days[range]) if range != 'all' else None
    def inside(timestamp):
        value = utc(timestamp)
        return (start is None or value >= start) and value <= now

    incidents = session.exec(select(Incident)).all()
    reports = session.exec(select(Report)).all()
    evidence = all_evidence(session)
    by_incident = defaultdict(list)
    for report in reports:
        by_incident[report.incident_id].append(report)
    responses = [incident_payload(session, item, evidence=evidence, reports=by_incident[item.id]) for item in incidents]
    lookup = {item['id']: item for item in responses}
    selected = [item for item in incidents if inside(item.created_at)
                and (not category or item.category == category)
                and (not location or item.location == location)
                and (not evidence_level or lookup[item.id]['evidence_level'] == evidence_level)]
    ids = {item.id for item in selected}
    selected_reports = [report for report in reports if report.incident_id in ids and inside(report.created_at)]
    selected_evidence = [item for item in evidence if item['incident_id'] in ids and inside(datetime.fromisoformat(item['uploaded_at']))]
    confirmations = sum(item.confirmations for item in selected)
    contradictions = sum(item.contradictions for item in selected)
    levels = {level: sum(lookup[item.id]['evidence_level'] == level for item in selected) for level in LEVELS}
    category_counts = Counter(item.category for item in selected)
    incident_locations = Counter(item.location for item in selected)
    report_locations = Counter(report.location for report in selected_reports)
    locations = [{'location': name, 'incidents': incident_locations[name], 'reports': report_locations[name]}
                 for name in set(incident_locations) | set(report_locations)]
    locations.sort(key=lambda row: (-row['reports'], -row['incidents'], row['location']))

    earliest = min([utc(item.created_at) for item in selected] + [utc(report.created_at) for report in selected_reports], default=now)
    grouping = 'hour' if range == '24h' else 'month' if range == 'all' and (now - earliest).days > 90 else 'day'
    def bucket(value):
        value = utc(value)
        return value.replace(minute=0, second=0, microsecond=0) if grouping == 'hour' else value.replace(hour=0, minute=0, second=0, microsecond=0, **({'day': 1} if grouping == 'month' else {}))
    incident_periods = Counter(bucket(item.created_at) for item in selected)
    report_periods = Counter(bucket(report.created_at) for report in selected_reports)
    activity = []
    if selected or selected_reports:
        cursor, end = bucket(start or earliest), bucket(now)
        while cursor <= end:
            activity.append({'period': iso(cursor), 'incidents': incident_periods[cursor], 'reports': report_periods[cursor]})
            if grouping == 'month':
                cursor = cursor.replace(year=cursor.year + (cursor.month == 12), month=cursor.month % 12 + 1)
            else:
                cursor += timedelta(hours=1) if grouping == 'hour' else timedelta(days=1)

    health = {key: 0 for key in ['unique', 'exact_duplicates', 'near_duplicates', 'metadata_conflicts', 'location_conflicts', 'timestamp_conflicts', 'reviewed', 'flagged']}
    for item in selected_evidence:
        duplicate = item['duplicate_analysis']
        # Count resubmissions only, not the original image as another duplicate.
        if not duplicate['duplicate_of']:
            health['unique'] += 1
        else:
            prior = [other for other in evidence if other['id'] < item['id']]
            exact = any(other['sha256_hash'] == item['sha256_hash'] for other in prior)
            health['exact_duplicates' if exact else 'near_duplicates'] += 1
        time_conflict = item['time_consistency']['status'] == 'conflicting'
        location_conflict = item['location_consistency']['status'] == 'conflicting'
        health['timestamp_conflicts'] += time_conflict
        health['location_conflicts'] += location_conflict
        health['metadata_conflicts'] += time_conflict or location_conflict
        if item['review_state'] in ('reviewed', 'flagged'):
            health[item['review_state']] += 1

    reporters = defaultdict(set)
    scoped_counts = Counter(report.incident_id for report in selected_reports)
    for report in selected_reports:
        reporters[report.incident_id].add(report.reporter_token)
    distribution = [{'range': label, 'count': 0} for label in ['0-24', '25-49', '50-74', '75-100']]
    for item in selected:
        score = lookup[item.id]['support_score']
        distribution[min(int(score // 25), 3)]['count'] += 1
    recent = sorted(selected, key=lambda item: (utc(item.updated_at or item.created_at), item.id), reverse=True)[:8]
    recent_rows = [{**{key: lookup[item.id][key] for key in ['id', 'title', 'category', 'location', 'evidence_level', 'support_score', 'confirmations', 'updated_at']}, 'report_count': scoped_counts[item.id]} for item in recent]
    totals = {'active_incidents': len(selected), 'total_reports': len(selected_reports), 'confirmations': confirmations,
              'contradictions': contradictions, 'evidence_items': len(selected_evidence), 'strong_incidents': levels['Strong']}
    return {
        'summary': totals, 'activity': activity, 'activity_grouping': grouping, 'timezone': 'UTC',
        'generated_at': iso(now), 'filters': {'range': range, 'category': category, 'evidence_level': evidence_level, 'location': location},
        'available_locations': sorted({item.location for item in incidents}),
        'evidence_levels': levels,
        'categories': [{'category': name, 'incidents': category_counts[name]} for name in CATEGORIES + sorted(set(category_counts) - set(CATEGORIES))],
        'locations': locations[:8],
        'community': {'confirmations': confirmations, 'contradictions': contradictions,
                      'confirmation_ratio': confirmations / (confirmations + contradictions) if confirmations + contradictions else None},
        'evidence_health': health,
        'reporting': {'distinct_reporters': len({report.reporter_token for report in selected_reports}),
                      'average_reports_per_incident': round(len(selected_reports) / len(selected), 2) if selected else 0,
                      'multi_reporter_incidents': sum(len(tokens) > 1 for tokens in reporters.values()),
                      'single_reporter_incidents': sum(len(tokens) == 1 for tokens in reporters.values())},
        'support_distribution': distribution, 'recent_incidents': recent_rows,
        # Preserve the original endpoint fields for existing clients/tests.
        'total_incidents': len(selected), 'total_reports': len(selected_reports),
        'incidents_by_category': dict(category_counts), 'incidents_by_location': dict(incident_locations),
        'evidence_level_distribution': levels, 'confirmations': confirmations, 'contradictions': contradictions,
        'report_volume_over_time': [{'date': date, 'count': count} for date, count in sorted(Counter(utc(r.created_at).date().isoformat() for r in selected_reports).items())],
        **summary(selected_evidence),
    }
