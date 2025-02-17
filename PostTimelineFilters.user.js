// ==UserScript==
// @name         Post Timeline Filters
// @description  Inserts several filter options for post timelines
// @homepage     https://github.com/samliew/SO-mod-userscripts
// @author       @samliew
// @version      2.2
//
// @include      https://*stackoverflow.com/*
// @include      https://*serverfault.com/*
// @include      https://*superuser.com/*
// @include      https://*askubuntu.com/*
// @include      https://*mathoverflow.net/*
// @include      https://*stackapps.com/*
// @include      https://*.stackexchange.com/*
//
// @exclude      *chat.*
// @exclude      *blog.*
//
// @require      https://raw.githubusercontent.com/DmitryBaranovskiy/raphael/master/raphael.min.js
// @require      https://raw.githubusercontent.com/adrai/flowchart.js/master/release/flowchart.min.js
// ==/UserScript==

/* globals StackExchange, GM_info */

'use strict';

if (typeof unsafeWindow !== 'undefined' && window !== unsafeWindow) {
    window.jQuery = unsafeWindow.jQuery;
    window.$ = unsafeWindow.jQuery;
}

let $eventsContainer, $events;

const flowchartOpts = {
    'x': 0,
    'y': 0,
    'line-width': 2,
    'line-length': 20,
    'text-margin': 5,
    'font-size': 12,
    'font-color': '#6a737c',
    'line-color': 'black',
    'element-color': 'black',
    'fill': '#d6d9dc',
    'flowstate': {
        'pending': { 'fill': '#333' },
        'completed': { 'fill': '#8DB98D', 'font-color': '#fff', },
        'invalidated': { 'fill': '#ffcccc', 'font-color': '#572f32', 'font-style': 'italic' },
    }
};
if (document.body.classList.contains('theme-dark')) {

    // Dark theme
    flowchartOpts.fontColor = '#ccc';
    flowchartOpts.lineColor = '#ccc';
    flowchartOpts.elementColor = '#ccc';
    flowchartOpts.fill = '#111';
    flowchartOpts.flowstate = {
        'pending': { 'fill': '#666' },
        'completed': { 'fill': '#344b3a', 'font-color': '#ccc', },
        'invalidated': { 'fill': '#572f32', 'font-color': '#de7176', 'font-style': 'italic' },
    };
}


function initTimelineLinkConvertor() {

    function processTimelineLinks() {
        // Convert timeline links to show all events
        $('a.js-post-issue[href$="/timeline"]').attr('href', (i, v) => v + '?filter=WithVoteSummaries');
    }

    processTimelineLinks();
    $(document).ajaxStop(processTimelineLinks);
}


function drawReviewsFlowchart() {
    if (typeof flowchart === 'undefined') {
        console.error('flowchart library undefined');
        return;
    }

    const pid = Number(location.pathname.match(/\d+/)[0]);

    // do not process if pid < 1000000
    if (location.hostname == 'stackoverflow.com' && pid < 1000000) return;

    // Get first history event from timeline
    const firstevt = $events.filter(function (i, el) {
        return el.dataset.eventtype === 'history';
    }).last();
    const firstevtVerb = firstevt.find('.event-verb span, .wmn1 span').text().trim();
    const isQuestion = firstevtVerb == 'asked';

    // Get reviews from timeline
    const items = $events.filter(function (i, el) {
        const eType = $(el).find('span.event-type').text();
        return eType === 'review' || el.dataset.eventtype === 'review';
    }).not('.deleted-event-details');

    const reviews = items.get().map(function (el) {
        const r = Object.create(null, {}); // 'plain object'
        r.id = Number($(el).attr('data-eventid'));
        r.created = $(el).find('.relativetime').attr('title').trim();
        r.evttype = $(el).find('span.event-type').text().trim();
        r.verb = $(el).find('.event-verb span, .wmn1 span').text().trim();
        r.link = $(el).find('.event-verb a, .wmn1 a').attr('href');
        r._datehash = $(el).attr('data-datehash'); // for filtering out current event below when getting result

        // not a valid event - e.g.: review outcome
        if (typeof r.link == 'undefined') return;

        // try get additional "deleted-event-details" if review has completed
        const info = $events.filter((i, el) => el.dataset.eventid == r.id && el.dataset.datehash !== r._datehash);
        if (info.length === 1) {
            r.ended = info.find('.relativetime').attr('title').trim();
            r.outcome = info.find('.event-verb span, .wmn1 span').text().trim();
            r.comment = info.find('.event-comment span').text().trim();
        }

        return r;
    })
        .filter(v => v != null)
        .sort(function (a, b) { // asc
            return a.id - b.id;
        });
    console.table(reviews);

    // If no reviews, do nothing
    if (reviews.length == 0) return;

    // Build flowchart definitions
    let defs = '', flow = '\n\n';
    defs += `st=>start: ${firstevtVerb}:>/q/${pid}\n`;
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        defs += `review${i}=>operation: ${review.verb}|${review.outcome}:>${review.link}\n`;
    }
    //defs += 'end=>end: now';

    // Link flowchart definitions
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        if (i == 0 && reviews.length == 1) {
            flow += `st(right)->review0(right)->end\n`;
        }
        else if (i == 0 && reviews.length > 1) {
            flow += `st(right)->review0(right)->review1\n`;
        }
        else if (i + 1 < reviews.length) {
            flow += `review${i}(right)->review${i + 1}\n`;
        }
    }
    if (reviews.length > 1) {
        flow += `review${reviews.length - 1}(right)->end\n`;
    }
    console.log(defs, flow);

    // Draw diagram using library
    const canvas = $('<div id="review-flowchart"></div>').insertAfter('.mainbar-full .subheader');
    flowchart.parse(defs + flow).drawSVG('review-flowchart', flowchartOpts);

    // Insert title
    canvas.prepend('<h3 class="event-count">Review flowchart</h3>');

    // Links in diagram open in new tab/window
    canvas.find('a').attr('target', '_blank');
}


function filterPosts(filter) {
    console.log(`Filter by: ${filter}`);

    function getCommentIdFromFlagId(fid) {
        return Number($('.js-toggle-comment-flags').filter((i, el) => el.dataset.flagIds.split(';').includes(fid)).closest('tr').attr('data-eventid')) || null;
    }

    // Get sort function based on selected filter
    let filterFn;
    switch (filter) {

        case 'hide-votes':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType && eType !== 'votes' && eType !== 'comment flag'
                //&& !((eType !== 'flag' || eType !== '') && getCommentIdFromFlagId(el.dataset.eventid));
            };
            break;

        case 'hide-votes-comments':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType && eType !== 'votes' && eType !== 'comment' && eType !== 'comment flag' && el.dataset.eventtype !== 'comment'
                //&& !((eType !== 'flag' || eType !== '') && getCommentIdFromFlagId(el.dataset.eventid));
            };
            break;

        case 'only-votes':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType == 'votes';
            };
            break;

        case 'only-comments':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType === 'comment';
            };
            break;

        case 'only-answers':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType === 'answer';
            };
            break;

        case 'only-history':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType === 'history' || el.dataset.eventtype === 'vote';
            };
            break;

        case 'only-closereopen':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType === 'close' || eType === 'reopen';
            };
            break;

        case 'only-reviews':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType === 'review' || el.dataset.eventtype === 'review';
            };
            break;

        case 'only-flags':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType !== 'comment flag' && (eType === 'flag' || el.dataset.eventtype === 'flag');
            };
            break;

        case 'only-mod':
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType !== 'comment flag' && (eType === 'flag' || eType === 'close' || $(el).hasClass('deleted-event') || $(el).hasClass('deleted-event-details'));
            };
            break;

        default:
            filterFn = function (i, el) {
                const eType = $(el).find('span.event-type').text();
                return eType !== 'comment flag';
            };
            break;
    }

    $events.addClass('dno').filter(filterFn).removeClass('dno');

    // Once filtered, match related rows
    // e.g.: Hide that comment flags were cleared if the comment flag is currently hidden
    $('td.event-type').filter((i, el) => el.innerText == '').each(function (i, el) {
        const eventRow = $(this).closest('tr');
        const eid = eventRow.attr('data-eventid');
        const relatedVisible = $events.not(this).filter((i, el) => el.dataset.eventid === eid).first().is(':visible');
        //console.log('d2', relatedVisible, eid);
        eventRow.toggleClass('dno', !relatedVisible);
    });
}


function doPageLoad() {

    // Post flags page
    if (location.pathname.includes('/show-flags')) {

        // Show decline reason
        $('#mainbar-full .s-table td[title]').each(function () {

            // Colour-coded result
            let outcome = this.innerHTML.trim();
            if (outcome.toLowerCase().includes('declined')) {
                outcome = `<span class="fc-red-500 fw-bold">${outcome}</span>`;
            }
            else {
                outcome = `<span class="fc-green-500 fw-bold">${outcome}</span>`;
            }

            // Replace reason with inline text
            if (this.title.length > 0) {
                this.innerHTML = outcome + ':<br>' + this.title;
                this.removeAttribute('title');
            }
            else {
                this.innerHTML = outcome;
            }
        });

        // Add link to post timeline
        const pid = location.pathname.match(/\/\d+\//)[0].replace(/\//g, '');
        $('#mainbar-full .s-table').after(`<div class="mt12"><a href="/posts/${pid}/timeline?filter=WithVoteSummaries&filter=flags" class="s-btn s-btn__primary">View flags in post timeline</a></div>`);
    }

    // Post timeline page
    else if (location.pathname.includes('/timeline')) {

        // Redirect to version with post summaries
        if (!location.search.includes('filter=WithVoteSummaries')) {
            const hash = location.hash;
            history.replaceState(null, document.title, `?filter=WithVoteSummaries${hash}`);
            location.reload();
        }

        // Display whether this is a question or answer, and link to question if it's an answer...
        const title = $('.subheader h1');
        const link = title.find('a').first();
        if (link.attr('href').includes('#')) { // answer
            link.before('<span class="posttype-indicator">answer</span>');

            // link to question too
            const qid = Number(link.attr('href').match(/\/(\d+)\//)[1]);
            link.after(`<span class="timeline-linked-question">(<a href="https://${location.hostname}/q/${qid}" class="question-hyperlink">Q permalink</a> | <a href="https://${location.hostname}/posts/${qid}/timeline">Q timeline</a>)</span>`);
        }
        else {
            link.before('<span class="posttype-indicator">question</span>');
        }

        // Pre-trim certain elements once on page load to make filtering less complicated
        $('span.event-type, td.event-verb span a').text((i, v) => '' + v.trim());
        $('td.event-type, td.event-verb span').filter((i, el) => el.children.length === 0).text((i, v) => '' + v.trim());
        $('td.event-comment span').not('.badge-earned-check').filter((i, el) => el.innerText.trim() == '').remove();
        $('td.event-comment span div.mt6').each(function (i, el) { $(this).appendTo(el.parentNode.parentNode); });

        // Rename "CommentNoLongerNeeded" event-verb to take up less space
        $('.event-verb span').filter((i, el) => el.innerText.indexOf('Comment') === 0).text((i, v) => v.replace(/^Comment/, ''));

        $eventsContainer = $('table.post-timeline');
        $events = $('.event-rows > tr').not('.separator'); // .filter((i, el) => el.dataset.eventtype !== 'flag' && $(el).find('span.event-type').text() !== 'flag')

        const userType = StackExchange.options.user.isModerator ? 'mod' : 'normal';
        const postType = $('td.event-verb span').filter((i, el) => el.innerText === 'asked' || el.innerText === 'answered').text() === 'asked' ? 'question' : 'answer';

        console.log(userType, postType);

        // Insert sort options
        const $filterOpts = $(`<div id="post-timeline-tabs" class="tabs posttype-${postType} usertype-${userType}">
<a data-filter="all" class="youarehere">Show All</a>
<a data-filter="hide-votes" id="newdefault">Hide Votes</a>
<a data-filter="hide-votes-comments">Hide Votes & Comments</a>
<a data-filter="only-votes">Votes</a>
<a data-filter="only-comments">Comments</a>
<a data-filter="only-reviews">Reviews</a>
<a data-filter="only-answers" class="q-only">Answers</a>
<a data-filter="only-history" title="Edits, Delete, Undelete">History</a>
<a data-filter="only-closereopen" class="q-only">Close & Reopen</a>
<a data-filter="only-flags" class="mod-only">♦ Flags</a>
<a data-filter="only-mod" class="mod-only">♦ Mod-only</a>
</div>`)
            .insertBefore($eventsContainer);

        // Filter options event
        $('#post-timeline-tabs').on('click', 'a[data-filter]', function () {
            if ($(this).hasClass('youarehere')) return false;

            // Hide expanded flags
            $('.expander-arrow-small-show').click();

            // Filter posts based on selected filter
            filterPosts(this.dataset.filter);

            // Update active tab highlight class
            $(this).addClass('youarehere').siblings().removeClass('youarehere');

            return false;
        });

        // Hide votes (daily summary) is the new default
        if (location.search.includes('filter=flags')) {
            $('a[data-filter="only-flags"]').click();
        }
        else {
            $('a#newdefault').click();
        }

        // Draw reviews flowchat on post timeline page
        drawReviewsFlowchart();
    }

    // All other pages
    else initTimelineLinkConvertor();
}


// On page load
doPageLoad();


// Append styles
const styles = document.createElement('style');
styles.setAttribute('data-somu', GM_info?.script.name);
styles.innerHTML = `
.tabs:after,
#tabs:after {
    content: '';
    clear: both;
    display: block;
}
.tabs .youarehere,
#tabs .youarehere {
    position: relative;
    z-index: 1;
}
#post-timeline-tabs {
    float: none;
    margin: 20px 0 30px;
}
#post-timeline-tabs:after {
    position: relative;
    top: -1px;
    border-bottom: 1px solid var(--black-075);
}
#post-timeline-tabs a {
    float: left;
    margin-right: 8px;
    padding: 12px 8px 14px;
    color: #848d95;
    line-height: 1;
    text-decoration: none;
    border-bottom: 2px solid transparent;
    transition: all .15s ease-in-out;
}
#post-timeline-tabs a.youarehere {
    background: var(--orange-050);
    color: var(--black-900);
}

.posttype-answer .q-only,
.usertype-normal .mod-only {
    display: none;
}

table.post-timeline {
    border-bottom: 1px solid var(--black-100);
}
.timeline-page tr.separator {
    display: none !important;
}
.timeline-page tr.separator + tr {
    border-top: 1px solid var(--black-075);
}

.timeline-page .subheader h1 {
    position: relative;
}
.timeline-page .subheader h1 .posttype-indicator {
}
.timeline-page .subheader h1 .posttype-indicator:after {
    content: ': ';
}
.timeline-page .subheader h1 a.answer-hyperlink {
    display: inline-block;
    margin: 0;
}
.timeline-page .subheader h1 .timeline-linked-question {
    position: absolute;
    right: 0;
    bottom: -1em;
    margin-left: 20px;
    font-size: 0.9em;
    line-height: 1;
    white-space: nowrap;
}
.timeline-page .subheader h1 .timeline-linked-question a {
    font-size: 0.7em;
    text-transform: uppercase;
}
.timeline-page .subheader h1 .timeline-linked-question .post-id {
    display: none;
}

/* I hate the light blue bg for aggregate and deletion votes */
.post-timeline-v2 .post-timeline tr[data-eventtype="voteaggregate"] .event-type>span.vote {
    background-color: var(--black-600);
}
.post-timeline-v2 .post-timeline tr[data-eventtype="vote"] .event-type > span.vote {
    background-color: var(--red-700);
}
.post-timeline-v2 .post-timeline .event-type > span.history {
    color: var(--black-800);
}
.post-timeline-v2 .post-timeline .fc-red-400 {
    color: var(--red-700) !important;
}


/* Increase cell min-widths to avoid jumping when comment flags are expanded */
table.post-timeline td.event-type {
    min-width: 94px !important;
}
table.post-timeline .event-type + .wmn1 {
    min-width: 108px;
    width: 108px;
}
td.event-type span.event-type {
    font-size: 12px;
}

/* Review flowchart */
#review-flowchart {
    margin-bottom: 20px;
    clear: both;
}
#review-flowchart .event-count {
    margin-bottom: 10px;
}

/* Hide new event filter */
.post-timeline-v2 > fieldset {
    display: none;
}

/* Add visual quotes to comments text */
.timeline-page tr[data-eventtype="comment"] td.event-comment span:before {
    content: '"';
    display: inline-block;
    margin-right: -0.2em;
}
.timeline-page tr[data-eventtype="comment"] td.event-comment span:after {
    content: '"';
    display: inline-block;
    margin-left: -0.2em;
}
`;
document.body.appendChild(styles);
