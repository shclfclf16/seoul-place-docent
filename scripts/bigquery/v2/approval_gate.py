"""Offline review gate. Returns eligibility only; never publishes or copies media."""
from datetime import datetime, timezone
from urllib.parse import urlparse

ACTIONS = {'metadata', 'display', 'thumbnail', 'embed', 'storage', 'modification'}
CHECKS = ('human_review', 'original_source', 'rights', 'place', 'relation')


def https_url(value):
    try:
        url = urlparse(value)
        return url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password
    except (TypeError, ValueError):
        return False


def eligible(record, place, link, review, action='metadata', now=None):
    """Evidence is recorded by a trusted reviewer in a private, access-controlled registry.

    Do not accept this review object from public requests. Approval is bound to all
    three immutable rows, an action and an expiry, not an inferred source status.
    """
    if action not in ACTIONS or review.get('state') != 'APPROVED': return False
    if not review.get('reviewer_id') or not review.get('review_id'): return False
    now = now or datetime.now(timezone.utc)
    try:
        approved = datetime.fromisoformat(review['reviewed_at'])
        expiry = datetime.fromisoformat(review['expires_at'])
        if not approved.tzinfo or not expiry.tzinfo or not approved <= now < expiry: return False
    except (KeyError, TypeError, ValueError): return False
    if not record.get('record_id') or not place.get('place_id'): return False
    if (link.get('record_id'), link.get('place_id')) != (record['record_id'], place['place_id']): return False
    if not https_url(record.get('source_url')): return False
    for name, row in (('record', record), ('place', place), ('link', link)):
        for key in ('_batch_sha256', '_row_sha256'):
            if not row.get(key) or review.get(name + key) != row[key]: return False
    if len({row['_batch_sha256'] for row in (record, place, link)}) != 1: return False
    for check in CHECKS:
        evidence = review.get('checks', {}).get(check, {})
        if evidence.get('status') != 'VERIFIED' or not https_url(evidence.get('evidence_url')): return False
    # Exact match requires independently verified address/coordinates, never name alone.
    location = review.get('verified_location', {})
    if link.get('relation_type') == 'EXACT_SITE':
        if not location.get('address') or not https_url(location.get('evidence_url')): return False
        try:
            lat, lon = float(location['latitude']), float(location['longitude'])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180): return False
        except (KeyError, TypeError, ValueError): return False
    elif link.get('relation_type') not in {'NEARBY', 'DISTRICT_CONTEXT'}: return False
    permission = review.get('permissions', {}).get(action, {})
    if permission.get('status') != 'ALLOWED' or not https_url(permission.get('evidence_url')): return False
    if action == 'embed':
        if record.get('record_type') != 'VIDEO': return False
        if review.get('playback_review_status') != 'VERIFIED': return False
    if action in {'display', 'thumbnail'} and record.get('record_type') in {'PHOTO', 'MAP', 'DRAWING'}:
        if review.get('image_review_status') != 'VERIFIED': return False
    return True
