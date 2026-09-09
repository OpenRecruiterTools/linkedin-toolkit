"""AUTO-GENERATED — do not edit by hand.

Written by ``scripts/gen.py`` from ``mcp-server/openapi.json``, one method per
action in the contract. ``LinkedInToolkit`` and ``AsyncLinkedInToolkit`` both
inherit from this mixin: ``_invoke`` returns a value in the sync client and a
coroutine in the async one, so the same generated body serves both.
"""

from __future__ import annotations

from typing import Any, Optional

__all__ = ["ActionMethods", "ACTION_METHODS"]



class ActionMethods:
    """Every action in the contract, as a keyword-only method."""

    def _invoke(self, action: str, params: dict[str, Any]) -> Any:  # pragma: no cover
        raise NotImplementedError

    def status_get(self, *, verify: Optional[bool] = None, postUrl: Optional[str] = None) -> Any:
        """``status.get``.

        Check that the Chrome extension is connected and the user is logged in to LinkedIn. Call
        this first in any session and again after a rate-limit error; returns extension version,
        autopilot on/off, business-hours flag, per-quota usage (invite, message, visit, search),
        pending approval-queue size and campaign counts.

        Args:
            verify (bool): Optional.
            postUrl (str): Optional.
        """
        params = {"verify": verify, "postUrl": postUrl}
        return self._invoke("status.get", {k: v for k, v in params.items() if v is not None})

    def config_get(self) -> Any:
        """``config.get``.

        Run the `config.get` action on the connected extension.
        """
        return self._invoke("config.get", {})

    def config_set(self, *, minDelayMs: Optional[float] = None, maxDelayMs: Optional[float] = None, hourlyCap: Optional[float] = None, dailyInviteCap: Optional[float] = None, dailyMessageCap: Optional[float] = None, dailyVisitCap: Optional[float] = None, dailySearchCap: Optional[float] = None, businessHoursOnly: Optional[bool] = None, businessStart: Optional[float] = None, businessEnd: Optional[float] = None, weekdaysOnly: Optional[bool] = None, autopilot: Optional[bool] = None, accountPreset: Optional[str] = None, warmup: Optional[dict[str, Any]] = None, ai: Optional[dict[str, Any]] = None, bridge: Optional[dict[str, Any]] = None, webhookUrl: Optional[str] = None) -> Any:
        """``config.set``.

        Run the `config.set` action on the connected extension. This is a write action: it
        changes state on this machine and in the extension, and sends nothing to LinkedIn.

        Args:
            minDelayMs (float): Optional.
            maxDelayMs (float): Optional.
            hourlyCap (float): Optional.
            dailyInviteCap (float): Optional.
            dailyMessageCap (float): Optional.
            dailyVisitCap (float): Optional.
            dailySearchCap (float): Optional.
            businessHoursOnly (bool): Optional.
            businessStart (float): Optional.
            businessEnd (float): Optional.
            weekdaysOnly (bool): Optional.
            autopilot (bool): Optional.
            accountPreset (str): (one of "free", "premium", "salesnav", "recruiter") Optional.
            warmup (dict[str, Any]): Optional.
            ai (dict[str, Any]): Optional.
            bridge (dict[str, Any]): Optional.
            webhookUrl (str): Optional.
        """
        params = {"minDelayMs": minDelayMs, "maxDelayMs": maxDelayMs, "hourlyCap": hourlyCap, "dailyInviteCap": dailyInviteCap, "dailyMessageCap": dailyMessageCap, "dailyVisitCap": dailyVisitCap, "dailySearchCap": dailySearchCap, "businessHoursOnly": businessHoursOnly, "businessStart": businessStart, "businessEnd": businessEnd, "weekdaysOnly": weekdaysOnly, "autopilot": autopilot, "accountPreset": accountPreset, "warmup": warmup, "ai": ai, "bridge": bridge, "webhookUrl": webhookUrl}
        return self._invoke("config.set", {k: v for k, v in params.items() if v is not None})

    def search_people(self, *, keywords: str, title: Optional[str] = None, company: Optional[str] = None, location: Optional[str] = None, source: Optional[str] = None, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``search.people``.

        Search LinkedIn people and return structured profiles. Use it to build a candidate or
        prospect list from keywords plus optional title, company and location filters. Returns
        up to 100 profiles per call with nextStart for paging; the extension caps search results
        at 1,000 per day.

        Args:
            keywords (str): Required.
            title (str): Optional.
            company (str): Optional.
            location (str): Optional.
            source (str): (one of "search", "salesnav", "recruiter") Optional.
            start (int): (min 0) Optional.
            count (int): (min 1; max 100) Optional.
        """
        params = {"keywords": keywords, "title": title, "company": company, "location": location, "source": source, "start": start, "count": count}
        return self._invoke("search.people", {k: v for k, v in params.items() if v is not None})

    def profile_get(self, *, url: Optional[str] = None, publicId: Optional[str] = None, full: Optional[bool] = None) -> Any:
        """``profile.get``.

        Fetch one profile by URL or publicId. Use it before writing an invite or message so the
        copy can reference real detail. Returns the Profile; with full=true it also captures the
        rendered page text, photo and experience/education, which costs one profile visit
        against the 500/day cap.

        Args:
            url (str): Optional.
            publicId (str): Optional.
            full (bool): Optional.
        """
        params = {"url": url, "publicId": publicId, "full": full}
        return self._invoke("profile.get", {k: v for k, v in params.items() if v is not None})

    def profile_export(self, *, urls: list[str], full: Optional[bool] = None) -> Any:
        """``profile.export``.

        Fetch many profiles in one call from a list of LinkedIn URLs. Use it to hydrate a list
        you already have URLs for. Returns profiles plus a failed array of {url, error}; each
        profile counts against the 500 visits/day cap, so keep batches modest.

        Args:
            urls (list[str]): Required.
            full (bool): Optional.
        """
        params = {"urls": urls, "full": full}
        return self._invoke("profile.export", {k: v for k, v in params.items() if v is not None})

    def company_get(self, *, url: Optional[str] = None, universalName: Optional[str] = None) -> Any:
        """``company.get``.

        Fetch a company page by URL or universalName. Use it for account research before
        outreach. Returns name, industry, size, HQ, website, description and follower count.

        Args:
            url (str): Optional.
            universalName (str): Optional.
        """
        params = {"url": url, "universalName": universalName}
        return self._invoke("company.get", {k: v for k, v in params.items() if v is not None})

    def company_employees(self, *, universalName: str, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``company.employees``.

        List people who work at a company, by universalName. Use it for account-based sourcing
        once you know the company. Returns a page of profiles plus nextStart; results count
        against the daily search cap.

        Args:
            universalName (str): Required.
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"universalName": universalName, "start": start, "count": count}
        return self._invoke("company.employees", {k: v for k, v in params.items() if v is not None})

    def post_engagers(self, *, postUrl: str, kind: str, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``post.engagers``.

        List the people who liked or commented on a LinkedIn post. Use it to source warm leads
        who have shown intent. Returns engagers (a profile plus reaction or comment text) and
        nextStart.

        Args:
            postUrl (str): Required.
            kind (str): Required. (one of "likes", "comments", "both")
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"postUrl": postUrl, "kind": kind, "start": start, "count": count}
        return self._invoke("post.engagers", {k: v for k, v in params.items() if v is not None})

    def group_members(self, *, groupUrl: str, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``group.members``.

        List members of a LinkedIn group you belong to. Use it for niche sourcing. Returns a
        page of profiles plus nextStart.

        Args:
            groupUrl (str): Required.
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"groupUrl": groupUrl, "start": start, "count": count}
        return self._invoke("group.members", {k: v for k, v in params.items() if v is not None})

    def event_attendees(self, *, eventUrl: str, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``event.attendees``.

        List attendees of a LinkedIn event you can see. Use it to source people around a
        conference or webinar. Returns a page of profiles plus nextStart.

        Args:
            eventUrl (str): Required.
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"eventUrl": eventUrl, "start": start, "count": count}
        return self._invoke("event.attendees", {k: v for k, v in params.items() if v is not None})

    def network_connections(self, *, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``network.connections``.

        List the user's own first-degree connections. Use it to work an existing network rather
        than sending new invites. Returns a page of profiles plus nextStart.

        Args:
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"start": start, "count": count}
        return self._invoke("network.connections", {k: v for k, v in params.items() if v is not None})

    def network_followers(self, *, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``network.followers``.

        Run the `network.followers` action on the connected extension.

        Args:
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"start": start, "count": count}
        return self._invoke("network.followers", {k: v for k, v in params.items() if v is not None})

    def network_status(self, *, publicIds: list[str]) -> Any:
        """``network.status``.

        Check whether the user is already connected to, or has a pending invite with, each of
        the given publicIds. Always call this before sending invites so you do not re-invite
        existing connections. Returns a map publicId to connected | pending | none.

        Args:
            publicIds (list[str]): Required.
        """
        params = {"publicIds": publicIds}
        return self._invoke("network.status", {k: v for k, v in params.items() if v is not None})

    def network_unfollow_count(self) -> Any:
        """``network.unfollowCount``.

        Run the `network.unfollowCount` action on the connected extension.
        """
        return self._invoke("network.unfollowCount", {})

    def network_unfollow_all(self, *, limit: Optional[int] = None, dryRun: Optional[bool] = None) -> Any:
        """``network.unfollowAll``.

        Run the `network.unfollowAll` action on the connected extension.

        Args:
            limit (int): (min 1; max 5000) Optional.
            dryRun (bool): Optional.
        """
        params = {"limit": limit, "dryRun": dryRun}
        return self._invoke("network.unfollowAll", {k: v for k, v in params.items() if v is not None})

    def outreach_view(self, *, publicId: str, dry_run: Optional[bool] = None) -> Any:
        """``outreach.view``.

        Visit a profile so the visit shows up in their "who viewed your profile". Use it as a
        light warm-up touch before an invite. This is a direct, metered action: it is paced and
        drawn from the visit bucket (500 visits/day) but never queued for approval, so the
        result status is "sent". Pass dry_run to preview.

        Args:
            publicId (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"publicId": publicId, "dry_run": dry_run}
        return self._invoke("outreach.view", {k: v for k, v in params.items() if v is not None})

    def outreach_follow(self, *, publicId: str, dry_run: Optional[bool] = None) -> Any:
        """``outreach.follow``.

        Follow a person without sending a connection invite. Use it when an invite would be too
        strong a first touch. This is a direct, metered action: it is paced and drawn from the
        visit bucket but never queued for approval, so the result status is "sent". Pass dry_run
        to preview.

        Args:
            publicId (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"publicId": publicId, "dry_run": dry_run}
        return self._invoke("outreach.follow", {k: v for k, v in params.items() if v is not None})

    def outreach_invite(self, *, publicId: str, note: Optional[str] = None, dry_run: Optional[bool] = None) -> Any:
        """``outreach.invite``.

        Send a connection invite, optionally with a note of at most 200 characters (LinkedIn's
        own limit; a longer note is refused with INVALID_PARAMS, so aim for 180 or fewer). Check
        linkedin_get_connection_status first. Hard cap 100 invites/day; in Copilot mode (the
        default) the invite is queued for human approval and the result status is "queued"
        rather than "sent". Note that on a free account LinkedIn allows only a few personalised
        (with-note) invitations a month, so prefer a note where it will count. Pass dry_run to
        preview the exact payload.

        Args:
            publicId (str): Required.
            note (str): Optional.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"publicId": publicId, "note": note, "dry_run": dry_run}
        return self._invoke("outreach.invite", {k: v for k, v in params.items() if v is not None})

    def outreach_message(self, *, publicId: str, body: str, dry_run: Optional[bool] = None) -> Any:
        """``outreach.message``.

        Send a direct message to a first-degree connection. Hard cap 150 messages/day; in
        Copilot mode it is queued for approval. Returns a WriteResult; pass dry_run to preview.

        Args:
            publicId (str): Required.
            body (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"publicId": publicId, "body": body, "dry_run": dry_run}
        return self._invoke("outreach.message", {k: v for k, v in params.items() if v is not None})

    def outreach_inmail(self, *, publicId: str, subject: str, body: str, dry_run: Optional[bool] = None) -> Any:
        """``outreach.inmail``.

        Send an InMail with a subject line (requires Premium, Sales Navigator or Recruiter).
        Counts against the message cap and queues for approval in Copilot mode. Returns a
        WriteResult; pass dry_run to preview.

        Args:
            publicId (str): Required.
            subject (str): Required.
            body (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"publicId": publicId, "subject": subject, "body": body, "dry_run": dry_run}
        return self._invoke("outreach.inmail", {k: v for k, v in params.items() if v is not None})

    def outreach_like(self, *, postUrl: str, dry_run: Optional[bool] = None) -> Any:
        """``outreach.like``.

        Like a post by URL. Use it as a low-risk warm-up touch before inviting the author. This
        is a direct, metered action: it is paced and drawn from the visit bucket but never
        queued for approval, so the result status is "sent". Unlike a comment, a like carries no
        words of yours. Pass dry_run to preview.

        Args:
            postUrl (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"postUrl": postUrl, "dry_run": dry_run}
        return self._invoke("outreach.like", {k: v for k, v in params.items() if v is not None})

    def outreach_comment(self, *, postUrl: str, body: str, dry_run: Optional[bool] = None) -> Any:
        """``outreach.comment``.

        Comment on a post by URL. Use it for public engagement before outreach; comments are
        queued for approval in Copilot mode because they are visible to everyone. Returns a
        WriteResult; pass dry_run to preview.

        Args:
            postUrl (str): Required.
            body (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"postUrl": postUrl, "body": body, "dry_run": dry_run}
        return self._invoke("outreach.comment", {k: v for k, v in params.items() if v is not None})

    def inbox_threads(self, *, since: Optional[float] = None, unreadOnly: Optional[bool] = None, count: Optional[int] = None) -> Any:
        """``inbox.threads``.

        List LinkedIn inbox threads, optionally only those since a timestamp or only unread. Use
        it to triage replies. Returns threads with participants, snippet, unread flag and
        sentiment when the extension has an AI provider configured.

        Args:
            since (float): Optional.
            unreadOnly (bool): Optional.
            count (int): (min 1) Optional.
        """
        params = {"since": since, "unreadOnly": unreadOnly, "count": count}
        return self._invoke("inbox.threads", {k: v for k, v in params.items() if v is not None})

    def inbox_messages(self, *, threadId: str, since: Optional[float] = None) -> Any:
        """``inbox.messages``.

        Fetch the messages in one thread by threadId. Use it after linkedin_get_conversations to
        read the full exchange before replying. Returns messages with sender publicId, body and
        sentAt.

        Args:
            threadId (str): Required.
            since (float): Optional.
        """
        params = {"threadId": threadId, "since": since}
        return self._invoke("inbox.messages", {k: v for k, v in params.items() if v is not None})

    def inbox_export(self, *, since: Optional[float] = None) -> Any:
        """``inbox.export``.

        Run the `inbox.export` action on the connected extension.

        Args:
            since (float): Optional.
        """
        params = {"since": since}
        return self._invoke("inbox.export", {k: v for k, v in params.items() if v is not None})

    def list_create(self, *, name: str, tags: Optional[list[str]] = None, dry_run: Optional[bool] = None) -> Any:
        """``list.create``.

        Create a named local list to hold prospects. Use it as the container for search results
        before enrolling them in a campaign. Returns the List with its listId. Lists live only
        in the local extension storage.

        Args:
            name (str): Required.
            tags (list[str]): Optional.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"name": name, "tags": tags, "dry_run": dry_run}
        return self._invoke("list.create", {k: v for k, v in params.items() if v is not None})

    def list_get_all(self) -> Any:
        """``list.getAll``.

        List every local list. Use it to discover listIds before adding members or creating a
        campaign. Returns all List records with their member counts.
        """
        return self._invoke("list.getAll", {})

    def list_get(self, *, listId: str) -> Any:
        """``list.get``.

        Fetch one list by listId. Use it to confirm a list exists and how many members it holds.
        Returns the List record.

        Args:
            listId (str): Required.
        """
        params = {"listId": listId}
        return self._invoke("list.get", {k: v for k, v in params.items() if v is not None})

    def list_add(self, *, listId: str, profiles: Optional[list[dict[str, Any]]] = None, publicIds: Optional[list[str]] = None, dry_run: Optional[bool] = None) -> Any:
        """``list.add``.

        Add profiles (or bare publicIds) to a list. Use it to save search or engager results for
        later outreach. Duplicates are skipped; returns {added, duplicates}.

        Args:
            listId (str): Required.
            profiles (list[dict[str, Any]]): Optional.
            publicIds (list[str]): Optional.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"listId": listId, "profiles": profiles, "publicIds": publicIds, "dry_run": dry_run}
        return self._invoke("list.add", {k: v for k, v in params.items() if v is not None})

    def list_remove(self, *, listId: str, publicIds: list[str]) -> Any:
        """``list.remove``.

        Run the `list.remove` action on the connected extension. This is a write action: it
        changes state on this machine and in the extension, and sends nothing to LinkedIn.

        Args:
            listId (str): Required.
            publicIds (list[str]): Required.
        """
        params = {"listId": listId, "publicIds": publicIds}
        return self._invoke("list.remove", {k: v for k, v in params.items() if v is not None})

    def list_members(self, *, listId: str, start: Optional[int] = None, count: Optional[int] = None) -> Any:
        """``list.members``.

        Page through the members of a list. Use it to read back what is in a list, including
        tags, whether each person was contacted before and any signals. Returns members plus
        total.

        Args:
            listId (str): Required.
            start (int): (min 0) Optional.
            count (int): (min 1) Optional.
        """
        params = {"listId": listId, "start": start, "count": count}
        return self._invoke("list.members", {k: v for k, v in params.items() if v is not None})

    def list_delete(self, *, listId: str) -> Any:
        """``list.delete``.

        Run the `list.delete` action on the connected extension. This is a write action: it
        changes state on this machine and in the extension, and sends nothing to LinkedIn.

        Args:
            listId (str): Required.
        """
        params = {"listId": listId}
        return self._invoke("list.delete", {k: v for k, v in params.items() if v is not None})

    def list_import_csv(self, *, listId: str, csv: str) -> Any:
        """``list.importCsv``.

        Run the `list.importCsv` action on the connected extension. This is a write action: it
        changes state on this machine and in the extension, and sends nothing to LinkedIn.

        Args:
            listId (str): Required.
            csv (str): Required.
        """
        params = {"listId": listId, "csv": csv}
        return self._invoke("list.importCsv", {k: v for k, v in params.items() if v is not None})

    def campaign_create(self, *, name: str, steps: list[dict[str, Any]], listId: Optional[str] = None, publicIds: Optional[list[str]] = None, settings: Optional[dict[str, Any]] = None, dry_run: Optional[bool] = None) -> Any:
        """``campaign.create``.

        Create a multi-step outreach sequence (view, follow, invite, message, inmail, like,
        comment, wait, branch) over a list or explicit publicIds. Use it instead of firing
        individual writes when the touches should be spaced over days. Returns the Campaign;
        steps still obey every quota and the approval queue.

        Args:
            name (str): Required.
            steps (list[dict[str, Any]]): Required.
            listId (str): Optional.
            publicIds (list[str]): Optional.
            settings (dict[str, Any]): Optional.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"name": name, "steps": steps, "listId": listId, "publicIds": publicIds, "settings": settings, "dry_run": dry_run}
        return self._invoke("campaign.create", {k: v for k, v in params.items() if v is not None})

    def campaign_get_all(self) -> Any:
        """``campaign.getAll``.

        List every campaign with its status. Use it to find campaignIds and see what is
        currently running or paused.
        """
        return self._invoke("campaign.getAll", {})

    def campaign_get(self, *, campaignId: str) -> Any:
        """``campaign.get``.

        Fetch one campaign by campaignId including its stats. Use it to report on enrolled,
        sent, accepted, replied and positive counts per step.

        Args:
            campaignId (str): Required.
        """
        params = {"campaignId": campaignId}
        return self._invoke("campaign.get", {k: v for k, v in params.items() if v is not None})

    def campaign_enroll(self, *, campaignId: str, publicIds: list[str], dry_run: Optional[bool] = None) -> Any:
        """``campaign.enroll``.

        Enroll publicIds into an existing campaign. Use it to top up a running sequence with
        newly sourced people. Already-enrolled people are skipped; returns {enrolled, skipped}.

        Args:
            campaignId (str): Required.
            publicIds (list[str]): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"campaignId": campaignId, "publicIds": publicIds, "dry_run": dry_run}
        return self._invoke("campaign.enroll", {k: v for k, v in params.items() if v is not None})

    def campaign_pause(self, *, campaignId: str, dry_run: Optional[bool] = None) -> Any:
        """``campaign.pause``.

        Pause a campaign so no further steps execute. Use it immediately if replies look
        negative or a challenge was detected. Returns the updated Campaign.

        Args:
            campaignId (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"campaignId": campaignId, "dry_run": dry_run}
        return self._invoke("campaign.pause", {k: v for k, v in params.items() if v is not None})

    def campaign_resume(self, *, campaignId: str, dry_run: Optional[bool] = None) -> Any:
        """``campaign.resume``.

        Resume a paused campaign from where it stopped. Returns the updated Campaign.

        Args:
            campaignId (str): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"campaignId": campaignId, "dry_run": dry_run}
        return self._invoke("campaign.resume", {k: v for k, v in params.items() if v is not None})

    def campaign_delete(self, *, campaignId: str) -> Any:
        """``campaign.delete``.

        Run the `campaign.delete` action on the connected extension. This is a write action: it
        changes state on this machine and in the extension, and sends nothing to LinkedIn.

        Args:
            campaignId (str): Required.
        """
        params = {"campaignId": campaignId}
        return self._invoke("campaign.delete", {k: v for k, v in params.items() if v is not None})

    def campaign_tick(self) -> Any:
        """``campaign.tick``.

        Run the `campaign.tick` action on the connected extension.
        """
        return self._invoke("campaign.tick", {})

    def queue_list(self, *, status: Optional[str] = None) -> Any:
        """``queue.list``.

        List items in the human-approval queue, optionally filtered by status ("pending",
        "approved", "rejected", "sent" or "failed"). In Copilot mode every agent-originated
        write lands here first, so call this to show the user what is waiting, and poll it after
        linkedin_queue_approve to see what actually sent. Returns queue items with their action,
        params and target profile; a failed item carries result.error.

        Args:
            status (str): (one of "pending", "approved", "rejected", "sent", "failed") Optional.
        """
        params = {"status": status}
        return self._invoke("queue.list", {k: v for k, v in params.items() if v is not None})

    def queue_approve(self, *, ids: list[str], edits: Optional[dict[str, Any]] = None, dry_run: Optional[bool] = None) -> Any:
        """``queue.approve``.

        Approve queued writes by id so the extension sends them, optionally editing the note or
        body first. This works only when the user has turned Autopilot on: in the default
        Copilot mode approval is a human action and the extension answers UNAUTHORIZED, so show
        the queue with linkedin_queue_list and ask the user to approve in the popup. Returns
        {approved} immediately — the count marked approved, not sent. The extension then sends
        them one at a time at human pace, which takes seconds to minutes, so watch
        queue_item_sent events or poll linkedin_queue_list (status "sent" or "failed") rather
        than assuming the writes have landed when this returns. An edited note longer than 200
        characters is refused here with INVALID_PARAMS and nothing is approved.

        Args:
            ids (list[str]): Required.
            edits (dict[str, Any]): Optional.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"ids": ids, "edits": edits, "dry_run": dry_run}
        return self._invoke("queue.approve", {k: v for k, v in params.items() if v is not None})

    def queue_reject(self, *, ids: list[str], dry_run: Optional[bool] = None) -> Any:
        """``queue.reject``.

        Reject queued writes by id so they are never sent. Like approving, this works only when
        the user has turned Autopilot on; in the default Copilot mode the extension answers
        UNAUTHORIZED and the user rejects in the popup. Returns {rejected}.

        Args:
            ids (list[str]): Required.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"ids": ids, "dry_run": dry_run}
        return self._invoke("queue.reject", {k: v for k, v in params.items() if v is not None})

    def ai_complete(self, *, task: str, input: dict[str, Any]) -> Any:
        """``ai.complete``.

        Run the `ai.complete` action on the connected extension.

        Args:
            task (str): Required. (one of "opener", "summary", "sentiment", "comment", "score")
            input (dict[str, Any]): Required.
        """
        params = {"task": task, "input": input}
        return self._invoke("ai.complete", {k: v for k, v in params.items() if v is not None})

    def export_csv(self, *, kind: str, id: Optional[str] = None) -> Any:
        """``export.csv``.

        Run the `export.csv` action on the connected extension.

        Args:
            kind (str): Required. (one of "profiles", "list", "campaign", "inbox")
            id (str): Optional.
        """
        params = {"kind": kind, "id": id}
        return self._invoke("export.csv", {k: v for k, v in params.items() if v is not None})

    def research_resolve(self, *, rows: list[dict[str, Any]]) -> Any:
        """``research.resolve``.

        Resolve messy rows (a name, an email, a company domain) to LinkedIn people or companies
        without doing the full research gather. Use it as a cheap first pass to check match
        quality before spending visits on linkedin_research_pack. Returns each row with kind,
        publicId or universalName, a confidence score and candidate profiles.

        Args:
            rows (list[dict[str, Any]]): Required.
        """
        params = {"rows": rows}
        return self._invoke("research.resolve", {k: v for k, v in params.items() if v is not None})

    def research_pack(self, *, rows: list[dict[str, Any]], listName: Optional[str] = None, enrich: Optional[bool] = None, full: Optional[bool] = None, dry_run: Optional[bool] = None) -> Any:
        """``research.pack``.

        Turn a list of rows (name, LinkedIn URL, email, domain or company) into full research
        packs: resolved profile, company, recent posts, mutual connections, connection status,
        signals and a ready-to-read markdown brief per row. Use it as the one-shot "research
        these people for me" tool. The server waits for the job to finish and returns the packs;
        if it takes longer than the research timeout it returns {jobId, status:"running"} and
        you should poll linkedin_research_get.

        Args:
            rows (list[dict[str, Any]]): Required.
            listName (str): Optional.
            enrich (bool): Optional.
            full (bool): Optional.
            dry_run (bool): Preview the write without queueing or sending it. Optional.
        """
        params = {"rows": rows, "listName": listName, "enrich": enrich, "full": full, "dry_run": dry_run}
        return self._invoke("research.pack", {k: v for k, v in params.items() if v is not None})

    def research_get(self, *, jobId: str) -> Any:
        """``research.get``.

        Poll a research job by jobId. Use it after linkedin_research_pack returned status
        "running". Returns {jobId, status, done, total, packs} with the packs finished so far.

        Args:
            jobId (str): Required.
        """
        params = {"jobId": jobId}
        return self._invoke("research.get", {k: v for k, v in params.items() if v is not None})

    def sync_pull(self, *, since: Optional[float] = None) -> Any:
        """``sync.pull``.

        Pull everything changed in the extension since the last sync into the local SQLite
        mirror. Call it before linkedin_query_sql so the database is current. Returns per-table
        row counts and the new sync timestamp.

        Args:
            since (float): Optional.
        """
        params = {"since": since}
        return self._invoke("sync.pull", {k: v for k, v in params.items() if v is not None})


#: Every action, and the method name this package exposes it under.
ACTION_METHODS: dict[str, str] = {
    "status.get": "status_get",
    "config.get": "config_get",
    "config.set": "config_set",
    "search.people": "search_people",
    "profile.get": "profile_get",
    "profile.export": "profile_export",
    "company.get": "company_get",
    "company.employees": "company_employees",
    "post.engagers": "post_engagers",
    "group.members": "group_members",
    "event.attendees": "event_attendees",
    "network.connections": "network_connections",
    "network.followers": "network_followers",
    "network.status": "network_status",
    "network.unfollowCount": "network_unfollow_count",
    "network.unfollowAll": "network_unfollow_all",
    "outreach.view": "outreach_view",
    "outreach.follow": "outreach_follow",
    "outreach.invite": "outreach_invite",
    "outreach.message": "outreach_message",
    "outreach.inmail": "outreach_inmail",
    "outreach.like": "outreach_like",
    "outreach.comment": "outreach_comment",
    "inbox.threads": "inbox_threads",
    "inbox.messages": "inbox_messages",
    "inbox.export": "inbox_export",
    "list.create": "list_create",
    "list.getAll": "list_get_all",
    "list.get": "list_get",
    "list.add": "list_add",
    "list.remove": "list_remove",
    "list.members": "list_members",
    "list.delete": "list_delete",
    "list.importCsv": "list_import_csv",
    "campaign.create": "campaign_create",
    "campaign.getAll": "campaign_get_all",
    "campaign.get": "campaign_get",
    "campaign.enroll": "campaign_enroll",
    "campaign.pause": "campaign_pause",
    "campaign.resume": "campaign_resume",
    "campaign.delete": "campaign_delete",
    "campaign.tick": "campaign_tick",
    "queue.list": "queue_list",
    "queue.approve": "queue_approve",
    "queue.reject": "queue_reject",
    "ai.complete": "ai_complete",
    "export.csv": "export_csv",
    "research.resolve": "research_resolve",
    "research.pack": "research_pack",
    "research.get": "research_get",
    "sync.pull": "sync_pull",
}
