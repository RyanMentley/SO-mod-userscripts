// ==UserScript==
// @name         Chat Improvements
// @description  New responsive userlist with usernames and total count, more timestamps, use small signatures only, mods with diamonds, message parser (smart links), timestamps on every message, collapse room description and room tags, mobile improvements, expand starred messages on hover, highlight occurances of same user link, room owner changelog, pretty print styles, and more...
// @homepage     https://github.com/samliew/SO-mod-userscripts
// @author       @samliew
// @version      3.6
//
// @include      https://chat.stackoverflow.com/*
// @include      https://chat.stackexchange.com/*
// @include      https://chat.meta.stackexchange.com/*
//
// @grant        GM_xmlhttpRequest
//
// @connect      *
// @connect      self
// @connect      stackoverflow.com
// @connect      serverfault.com
// @connect      superuser.com
// @connect      askubuntu.com
// @connect      mathoverflow.com
// @connect      stackexchange.com
// ==/UserScript==

/* globals StackExchange, GM_info */

'use strict';

if (typeof unsafeWindow !== 'undefined' && window !== unsafeWindow) {
    window.jQuery = unsafeWindow.jQuery;
    window.$ = unsafeWindow.jQuery;
} else {
    unsafeWindow = window;
}


const store = window.localStorage;
const fkey = document.getElementById('fkey') ? document.getElementById('fkey').value : '';

const superusers = [584192];
const isSuperuser = () => superusers.includes(CHAT.CURRENT_USER_ID);

const newuserlist = $(`<div id="present-users-list"><span class="users-count"></span></div>`);
const tzOffset = new Date().getTimezoneOffset();
const now = new Date();
const dayAgo = Date.now() - 86400000;
const weekAgo = Date.now() - 7 * 86400000;
let messageEvents = [];


// Helper functions
jQuery.fn.reverse = [].reverse;

/**
 * @summary checks if the userscript is running on a transcript page
 * @returns {boolean}
 */
const isTranscriptPage = () => window.location.href.includes("transcript");

// Never unfreeze room 4 - old teacher's lounge
const doNotUnfreeze = [4];
// Unfreeze room
function unfreezeRoom(roomId, domain = 'chat.stackoverflow.com') {
    roomId = Number(roomId);
    return new Promise(function (resolve, reject) {
        if (isNaN(roomId)) { reject(); return; }
        if (doNotUnfreeze.includes(roomId)) { reject(); return; }

        $.post(`https://${domain}/rooms/setfrozen/${roomId}`, {
            freeze: false,
            fkey: fkey
        })
            .done(resolve)
            .fail(reject);
    });
}
// Unfreeze current room
function unfreezeCurrentRoom() {
    if (typeof CHAT !== 'undefined' && !isNaN(CHAT.CURRENT_ROOM_ID)) unfreezeRoom(CHAT.CURRENT_ROOM_ID);
}
// Unfreeze rooms displayed in sidebar
function unfreezeRooms() {
    $('#my-rooms li').each((i, el) => unfreezeRoom(el.id.replace(/^\D+/, '')));
}


// Get message info
function getMessage(mid) {
    return new Promise(function (resolve, reject) {
        if (typeof mid === 'undefined' || mid == null) { reject(); return; }

        $.get(`https://${location.hostname}/messages/${mid}/history`)
            .done(function (v) {
                //console.log('fetched message info', mid);

                const msg = $('.message:first', v);
                const msgContent = msg.find('.content');
                const userId = Number(msg.closest('.monologue')[0].className.match(/user-(-?\d+)/)[1]);
                const userName = msg.closest('.monologue').find('.username a').text();
                const timestamp = msg.prev('.timestamp').text();
                const permalink = msg.children('a').first().attr('href');
                const roomId = Number(permalink.match(/\/(\d+)/)[1]);

                const parentId = Number(($('.message-source:last', v).text().match(/^:(\d+)/) || ['0']).pop()) || null;

                resolve({
                    id: mid,
                    parentId: parentId,
                    roomId: roomId,
                    timestamp: timestamp,
                    permalink: permalink,
                    userId: userId,
                    username: userName,
                    html: msgContent.html().trim(),
                    text: msgContent.text().trim(),
                    stars: Number(msg.find('.stars .times').text()) || 0,
                    isPinned: msg.find('.owner-star').length == 1,
                });
            })
            .fail(reject);
    });
}

// Send new message in current room
function sendMessage(message) {
    return new Promise(function (resolve, reject) {
        if (typeof message === 'undefined' || message == null) { reject(); return; }

        $.post(`https://${location.hostname}/chats/${CHAT.CURRENT_ROOM_ID}/messages/new`, {
            text: message,
            fkey: fkey
        })
            .done(function (v) {
                resolve(v);
            })
            .fail(reject);
    });
}


function processMessageTimestamps(events) {
    if (typeof events === 'undefined') return;

    // Remove existing "yst" timestamps in favour of ours for consistency
    $('.timestamp').filter((i, el) => el.innerText.includes('yst')).remove();

    /*
    event: {
        content
        event_type
        message_id
        parent_id
        room_id
        time_stamp
        user_id
        user_name
    }
    */

    // Find messages without timestamp, then insert timestamp
    events.forEach(function (event) {
        const msgs = $('#message-' + event.message_id).parent('.messages');
        if (msgs.length && msgs.children('.timestamp').length == 0) {
            const d = new Date(event.time_stamp * 1000);
            let time = d.getHours() + ':' + (d.getMinutes().toString().length != 2 ? '0' : '') + d.getMinutes();
            let prefix = '';
            if (d < weekAgo) {
                prefix = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d) + ', ';
            }
            else if (d.getDate() != now.getDate()) {
                prefix = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d) + ' ';
            }
            msgs.prepend(`<div class="timestamp js-dynamic-timestamp">${prefix}${time}</div>`);
        }
    });

    // Cache results
    // Filter out the unique items, then merge with our cache
    // https://stackoverflow.com/a/23080662
    //messageEvents = messageEvents.concat(events.filter(function (item) {
    //    return messageEvents.indexOf(item) < 0;
    //}));
}

function getMessageEvents(beforeMsgId = 0, num = 100) {
    return new Promise(function (resolve, reject) {
        if (typeof CHAT === 'undefined' || CHAT.CURRENT_ROOM_ID === 'undefined') { reject(); return; }
        if (fkey == '') { reject(); return; }

        $.post(`https://${location.hostname}/chats/${CHAT.CURRENT_ROOM_ID}/events`, {
            'since': beforeMsgId,
            'mode': 'Messages',
            'msgCount': num,
            'fkey': fkey
        })
            .done(function (v) {
                processMessageTimestamps(v.events);
                resolve(v.events);
            })
            .fail(reject);
    });
}

function updateUserlist(init = false) {

    // Do not update new user list if mouse is on
    if (newuserlist.hasClass('mouseon')) return;

    // Do not update user list if updated less than X seconds ago
    if (init) {
        newuserlist.addClass('js-no-update');
    }
    else if (!init && newuserlist.hasClass('js-no-update')) {
        return;
    }

    // Add new list to parent if not initialized yet
    const userlist = $('#present-users');
    if (newuserlist.parents('#present-users').length == 0) {
        newuserlist.insertAfter(userlist);
    }

    // Bugfix: remove dupes from original list, e.g.: when any new message posted
    userlist.children('.user-container').each(function () {
        $(this).siblings(`[id="${this.id}"]`).remove();
    });

    // Create new temp list with users
    const templist = $(`<div id="present-users-list"></div>`);

    // Clone remaining users into temp list
    const users = userlist.children('.user-container').clone(true).each(function () {

        // Get username from img title attribute
        const username = $(this).find('img')[0].title;

        // Apply a class to inactive users
        $(this).toggleClass('inactive', this.style.opacity == "0.15");

        // Remove other fluff, append username, then insert into list
        $(this).off().removeAttr('style id alt width height').find('.data').remove();
        $(this).appendTo(templist).append(`<span class="username" title="${username}">${username}</span>`);
    });

    if (init) {
        // Redo list
        newuserlist.children('.user-container').remove();
        newuserlist.append(templist.children());
    }
    else {
        // Compare list with temp list and copy changes over
        templist.children().reverse().each(function () {
            const clname = '.' + this.className.match(/(user-\d+)/)[0];
            if (newuserlist.find(clname).length == 0) {
                newuserlist.prepend(this);
            }
        });
    }
    //console.log('userlist updated', init, users.length);

    // Add count of users below
    newuserlist.find('.users-count').text(users.length);

    // Add "currentuser" class to own userlist items
    $('#sidebar .user-' + CHAT.CURRENT_USER_ID).addClass('user-currentuser');

    // Remove full update blocker after X seconds
    setTimeout(() => {
        newuserlist.removeClass('js-no-update');
    }, 10000);
}

function initLoadMoreLinks() {

    // Always load more for long messages
    // can't use this for some reason: $('.more-data').click();
    // this opens the link in a new window sometimes: el.click();
    // so we implement our own full text fetcher
    $('.content .more-data').each(function (i, el) {
        const parent = $(this).parent('.content');
        $.get(el.href).done(function (data) {
            const tagName = parent.find(".partial").prop("tagName");
            let full;
            if (tagName === 'PRE') {
                // pre-formatted text, just remove leading spaces
                const text = data.replace(/(^|\n)[ ]{4}/g, '$1');
                full = $('<pre class="full"></pre>').html(text);
            } else {
                // normal text or a quote
                const isQuote = /^&gt;\s/.test(data);
                const html = data.replace(/^(:\d+|&gt;) /, '').replace(/\r\n?|\n/g, ' <br> ').replace(/(https?:\/\/(\S+))/gi, '<a href="$1">$2</a>');
                full = $(`<div class="full {isQuote ? 'quote' : 'text'}"></div>`).append(html);
            };
            parent.empty().append(full);
        });
    });
}

function reapplyPersistentChanges() {

    // Remove "switch to" from other room title tooltips
    $('#my-rooms > li > a').each(function () {
        if (this.classList.contains('reply-count')) return;
        this.innerText = this.title.replace('switch to ', '');
    });

    // Show other room's latest message in a tooltip when hovered
    $('#my-rooms .last-message .text').each(function () {
        this.title = this.innerText;
    });

    // Expand more starred posts in AMA chatroom since we have a scrolling sidebar
    $('#sidebar-content.wmx3 span.more').filter((i, el) => el.parentNode.innerText.includes('starred') && el.innerText.includes('more')).click();

    // Apply class to starred posts usernames in sidebar
    $('#starred-posts a[href^="/users/"]').addClass('starred-signature');

    // Remove existing "yst" timestamps in favour of ours for consistency
    $('.timestamp').filter((i, el) => el.innerText.includes('yst')).remove();

    initLoadMoreLinks();

    // If topbar is found
    if ($('#topbar').length) {
        $('.reply-info').off('click');
    }

    // Remove system messages if there are only ignored users messages between
    $('.monologue:hidden').remove();
    $('.system-message-container').prev('.system-message-container').hide();
}

function applyTimestampsToNewMessages() {

    setInterval(function () {

        // Append timestamps when new messages detected (after the last message with a timestamp!)
        const lastMessage = $('.monologue').filter((i, el) => $(el).find('.timestamp').length > 0).last();
        const newMsgs = lastMessage.nextAll().filter((i, el) => $(el).find('.timestamp').length == 0).find('.messages');

        // No new messages, do nothing
        if (newMsgs.length == 0) return;

        // Apply timestamps
        const d = new Date();
        let time = d.getHours() + ':' + (d.getMinutes().toString().length != 2 ? '0' : '') + d.getMinutes();
        newMsgs.each(function () {
            $(this).prepend(`<div class="timestamp">${time}</div>`);
        });

    }, 1000);
}



/*
   This function is intended to check for new messages and parse the message text
   - It converts non-transcript chatroom links to the room transcript
   - Attempt to display chat domain, and room name or message id with (transcript) label
   - Also unshortens Q&A links that are truncated by default with ellipsis
*/
function initMessageParser() {

    const transcriptIndicator = ' <i class="transcript-link">(transcript)</i>';

    function parseMessageLink(i, el) {

        // Ignore links to bookmarked conversations
        if (/\/rooms\/\d+\/conversation\//.test(el.href)) { }
        // Ignore X messages moved links
        else if (/^\d+ messages?$/.test(el.innerText)) { }
        // Ignore room info links
        else if (el.href.includes('/info/')) { }
        // Convert all other chatroom links to the room transcript
        else if (el.href.includes('chat.') && el.href.includes('/rooms/')) {
            el.href = el.href.replace('/rooms/', '/transcript/');
            el.innerText = el.innerText.replace('/rooms/', '/transcript/');
        }

        // Attempt to display chat domain, and room name or message id with (transcript) label
        if (el.href.includes('chat.') && el.href.includes('/transcript/') && /stack(overflow|exchange)\.com/.test(el.innerText)) {
            let chatDomain = [
                { host: 'chat.stackexchange.com', name: 'SE chat' },
                { host: 'chat.meta.stackexchange.com', name: 'MSE chat' },
                { host: 'chat.stackoverflow.com', name: 'SO chat' }
            ].filter(v => v.host == el.hostname).pop() || '';
            let roomName = el.href.split('/').pop()
                .replace(/[?#].+$/, '').replace(/-/g, ' ') // remove non-title bit from url
                .replace(/\b./g, m => m.toUpperCase()) // title case
                .replace(/\b\w{2}\b/g, m => m.toUpperCase()); // capitalize two-letter words
            let messageId = Number((el.href.match(/(#|\?m=)(\d+)/) || [0]).pop());

            // Check if we have a valid parsed message id
            if (messageId == 0) messageId = roomName;

            // Display message id
            if (el.href.includes('/message/') || el.href.includes('?m=')) {
                el.innerHTML = chatDomain.name +
                    (!isNaN(Number(roomName)) && !el.href.includes('/message/') ? ', room #' + roomName : '') +
                    ', message #' + messageId + transcriptIndicator;
            }
            // Display room name
            else if (isNaN(Number(roomName))) {
                // Change link text to room name only if link text is a URL
                if (/(^https?|\.com)/.test(el.innerText)) {

                    // Properly capitalize common room names
                    roomName = roomName.replace('Javascript', 'JavaScript');

                    el.innerHTML = roomName + transcriptIndicator;
                }
                else {
                    el.innerHTML += transcriptIndicator;
                }
            }
            // Fallback to generic domain since no room slug
            else {
                el.innerHTML = chatDomain.name + ', room #' + roomName + transcriptIndicator;
            }

            // Verbose links should not wrap across lines
            $(this).addClass('nowrap');
        }

        // Shorten Q&A links
        else if (((el.href.includes('/questions/') && !el.href.includes('/tagged/')) || el.href.includes('/q/') || el.href.includes('/a/')) && el.innerText.includes('…')) {

            var displayUrl = el.href;

            // Strip certain querystrings
            displayUrl = displayUrl.replace(/[?&]noredirect=1/, '');

            // Get comment target (is it on a question or answer), based on second parameter
            let commentId = null, commentTarget = null;
            if (/#comment\d+_\d+$/.test(el.href)) {
                commentId = el.href.match(/#comment(\d+)_\d+$/)[1];
                commentTarget = Number(el.href.match(/#comment\d+_(\d+)$/)[1]);
            }

            // If long answer link
            if (el.href.includes('/questions/') && /\/\d+\/[\w-]+\/\d+/.test(el.href)) {

                // If has comment in url, check if comment target is answer
                if (commentId != null && commentTarget != null) {
                    const answerId = Number(el.href.match(/\/\d+\/[\w-]+\/(\d+)/)[1]);

                    if (commentTarget == answerId) {
                        // Convert to short answer link text with comment hash
                        displayUrl = displayUrl.replace(/\/questions\/\d+\/[^\/]+\/(\d+)(#\d+)?(#comment\d+_\d+)?$/i, '/a/$1') +
                            '#comment' + commentId;
                    }
                    else {
                        // Convert to short question link text with comment hash
                        displayUrl = displayUrl.replace(/\/questions\/(\d+)\/[^\/]+\/(\d+)(#\d+)?(#comment\d+_\d+)?$/i, '/q/$1') +
                            '#comment' + commentId;
                    }
                }
                else {
                    // Convert to short answer link text
                    displayUrl = displayUrl.replace(/\/questions\/\d+\/[^\/]+\/(\d+)(#\d+)?(#comment\d+_\d+)?$/i, '/a/$1');
                }
            }
            // If long question link
            else {

                // Convert to short question link text
                // Avoid truncating inline question links
                displayUrl = displayUrl.replace('/questions/', '/q/').replace(/\?(&?(cb|noredirect)=\d+)+/i, '').replace(/(\/\D[\w-]*)+((\/\d+)?#comment\d+_\d+)?$/, '') +
                    (commentId != null ? '#comment' + commentId : '');
            }

            el.innerText = displayUrl;
        }

        // Shorten /questions/tagged links, but ignore tag inline-boxes
        else if (el.href.includes('/questions/tagged/') && el.children.length == 0) {

            el.innerText = el.href.replace('/questions/tagged/', '/tags/');
        }

        // Remove user id if question or answer
        if ((el.href.includes('/q/') || el.href.includes('/a/')) && /\/\d+\/\d+$/.test(el.href)) {
            el.href = el.href.replace(/\/\d+$/, '');
            el.innerText = el.innerText.replace(/\/\d+$/, '');
        }

        // For all other links that are still truncated at this stage,
        if (el.innerText.includes('…')) {

            // display full url if url is <64 chars incl protocol
            if (el.href.length < 64) {
                el.innerText = el.href;
            }
            // else display next directory path if it's short enough
            else {
                let displayed = el.innerText.replace('…', '');
                let hiddenPath = el.href.replace(/^https?:\/\/(www\.)?/, '').replace(displayed, '').replace(/\/$/, '').split('/');
                let hiddenPathLastIndex = hiddenPath.length - 1;
                let shown1;
                //console.log(hiddenPath);

                // If next hidden path is short, or is only hidden path
                if (hiddenPath[0].length <= 25 || (hiddenPath.length == 1 && hiddenPath[hiddenPathLastIndex].length <= 50)) {
                    el.innerText = displayed + hiddenPath[0];
                    shown1 = true;

                    // if there are >1 hidden paths, continue displaying ellipsis at the end
                    if (hiddenPath.length > 1) {
                        el.innerText += '/…';
                    }
                }

                // Display last directory path if it's short enough
                if (hiddenPath.length > 1 && hiddenPath[hiddenPathLastIndex].length <= 50) {
                    el.innerText += '/' + hiddenPath[hiddenPathLastIndex];

                    // if full url is shown at this stage, strip ellipsis
                    if (shown1 && hiddenPath.length <= 2) {
                        el.innerText = el.innerText.replace('/…', '');
                    }
                }
            }
        }

        // Finally we trim all protocols and trailing slashes for shorter URLs
        if (/(^https?|\/$)/.test(el.innerText)) {
            el.innerText = el.innerText.replace(/^https?:\/\//i, '').replace(/\/$/, '');
        }
    }

    function parseRoomMini(i, el) {

        // Convert main chatroom title link to the room transcript
        const roomLink = el.querySelector('a');
        roomLink.href = roomLink.href.replace('/rooms/', '/transcript/');
        roomLink.innerText = roomLink.innerText.replace('/rooms/', '/transcript/');

        // Show longer description
        const desc = $(el).find('.room-mini-description').each(function (i, el) {
            el.innerHTML = el.title.replace(/https?:\/\/[^\s]+/gi, '<a href="$&" rel="nofollow noopener noreferrer">$&</a>');
            el.title = "";
        });
    }

    function parseMessagesForUsernames(i, el) {

        // Ignore oneboxes
        if ($(el).find('.onebox').length > 0) return;

        // Has mentions, wrap in span tag so we can select and highlight it
        // (\b|\s) instead of just \b so it allows usernames ending with periods '.'
        if (el.textContent.includes('@')) {
            el.innerHTML = el.innerHTML.replace(/(^@|\s@)([\w\u00C0-\u017F.-]+[^.\s])(\.?(\b|\s))/g, ' <span class="mention-others" data-username="$2">@$2</span>$3');
        }
    }

    setInterval(function () {

        // Get new messages
        const newMsgs = $('.message').not('.js-parsed').addClass('js-parsed');
        if (newMsgs.length > 0) {

            // Try to detect usernames and mentions in messages
            newMsgs.find('.content').each(parseMessagesForUsernames);

            // Parse message links, but ignoring oneboxes, room minis, and quotes
            newMsgs.find('.content a').filter(function () {
                return $(this).parents('.onebox, .quote, .room-mini').length == 0;
            }).each(parseMessageLink);

            // Parse room minis
            newMsgs.find('.room-mini').each(parseRoomMini);
        }

        // Get new starred messages
        const newStarredMsgs = $('#starred-posts li').not('.js-parsed').addClass('js-parsed');
        if (newStarredMsgs.length > 0) {

            // Parse links, but ignoring transcript links
            newStarredMsgs.find('a').filter(function () {
                return !this.href.includes('/transcript/');
            }).each(parseMessageLink);
        }

        // Parse user-popups, if it's a room link, convert to transcript link
        const userpopup = $('.user-popup');
        userpopup.find('a').filter(function () {
            return this.pathname.indexOf('/rooms/') == 0 && $(this).attr('href') != '#';
        }).each(parseMessageLink);

        // Parse notifications (room invites)
        const notificationLinks = $('.notification-message a').filter(function () {
            return this.pathname.indexOf('/rooms/') == 0 && $(this).attr('href') != '#';
        }).each(parseMessageLink);

    }, 1000);
}
/* End message parser */



function initUserHighlighter() {

    // Highlight elements with username on any mouse hover
    const eventSelector = '.tiny-signature, .sidebar-widget .user-container, .mention-others, .content a[href*="/users/"]';
    $('#widgets, #chat, #transcript').on('mouseover', eventSelector, function () {
        const userName = (this.dataset.username || $(this).find('.username, .name').last().text() || this.innerText || "").replace(/[^\w\u00C0-\u017F.-]+/g, '').toLowerCase();
        if (userName) {
            $('.username .name, .username, .mention, .mention-others, .starred-signature')
                .filter((i, el) => (el.dataset.username || el.title || el.innerText).replace(/[^\w\u00C0-\u017F.-]+/g, '').toLowerCase() == userName)
                .closest('.mention, .mention-others, .signature, .sidebar-widget .user-container, a[href*="/users/"]').addClass('js-user-highlight');
            $('#present-users-list').addClass('mouseon');
        }
    }).on('mouseout', eventSelector, function () {
        $('.js-user-highlight').removeClass('js-user-highlight');
        $('#present-users-list').removeClass('mouseon');
    });
}



function addLinksToOtherChatDomains() {

    // Add links to other chat domains when on Chat.SO
    const allrooms = $('#allrooms, #info a:first');
    if (allrooms[0].href.includes('stackoverflow.com')) {
        allrooms.after(`<a rel="noopener noreferrer" id="allrooms2" class="button" href="https://chat.stackexchange.com">Chat.SE</a> <a rel="noopener noreferrer" id="allrooms3" class="button" href="https://chat.meta.stackexchange.com">Chat.MSE</a>`);
    }
}



// Improve reply-info marker hover & click
function initBetterMessageLinks() {

    const isTranscript = $('#transcript-body').length;
    const hasTopbar = $('#topbar, .topbar').length;
    const topbarOffset = hasTopbar ? 50 : 0;
    window.hiTimeout = null;

    // Try loading more messages once
    $('#chat').one('mouseover', '.reply-info', function (evt) {
        $('#getmore').click();
    });

    // Re-implement scroll to message, and for transcripts
    $('#chat, #transcript').on('click', '.reply-info', function (evt) {
        // Clear all message highlights on page
        if (window.hiTimeout) clearTimeout(window.hiTimeout);
        $('.highlight').removeClass('highlight');

        const message = $(this).closest('.message');
        const parentMid = Number(this.href.match(/#(\d+)/).pop());
        const parentMsg = $('#message-' + parentMid).addClass('highlight');
        const dialogMsg = $('#dialog-message-' + parentMid);

        // Check if message is on page
        if (parentMsg.length) {
            $('html, body').animate({ scrollTop: (parentMsg.offset().top - topbarOffset) + 'px' }, 400, function () {
                window.hiTimeout = setTimeout(() => { parentMsg.removeClass('highlight'); }, 3000);
            });
            return false;
        }

        // Else message is off page, show in popup first
        // second clicking will trigger default behaviour (open in new window)
        else if (!dialogMsg.length) {

            getMessage(parentMid).then(function (msg) {
                const parentIcon = isNaN(msg.parentId) ? `<a class="reply-info" title="This is a reply to an earlier message" href="/transcript/message/${msg.parentId}#${msg.parentId}"> </a>` : '';
                const parentDialog = $(`
<div class="dialog-message" id="dialog-message-${msg.id}">
  <a class="action-link" href="/transcript/message/${msg.id}#${msg.id}"><span class="img menu"> </span></a>
  ${parentIcon}
  <div class="content">${msg.html}</div>
  <span class="meta"><span class="newreply" data-mid="${msg.id}" title="link my next chat message as a reply to this"></span></span>
  <span class="flash"><span class="stars vote-count-container"><span class="img vote" title="star this message as useful / interesting for the transcript"></span><span class="times">${msg.stars > 0 ? msg.stars : ''}</span></span></span>
</div>`);
                message.addClass('show-parent-dialog').prepend(parentDialog);
            });
            return false;
        }

    });

    if (isTranscript) return;

    // Dialog message replies


    // For live chat, implement additional helpers
    $('#chat, #transcript').on('mouseover', '.reply-info', function (evt) {
        const parentMid = Number(this.href.match(/#(\d+)/).pop());
        const parentMsg = $('#message-' + parentMid);

        // Check if message is off screen, show in popup
        if (parentMsg.length && (parentMsg.offset().top <= window.scrollY + topbarOffset || parentMsg.offset().top >= window.scrollY)) {
            // TODO

        }

    }).on('click', '.newreply', function (evt) {
        // Clear all message highlights on page
        $('.highlight').removeClass('highlight');
        // Highlight selected message we are replying to
        $(this).closest('.dialog-message, .message').addClass('highlight');
    }).on('click', '.dialog-message', function (evt) {
        $(this).closest('.message').find('.popup').remove();
        $(this).remove();
        return false;
    }).on('click', '.dialog-message .newreply', function (evt) {
        const input = document.getElementById('input');
        input.value = ':' + this.dataset.mid + ' ' + input.value.replace(/^:\d+\s*/, '');
        return false;
    }).on('click', 'a', function (evt) {
        evt.stopPropagation();
        return true;
    });
}

const chatHostnames = {
    "chat.stackoverflow.com": "Chat.SO",
    "chat.stackexchange.com": "Chat.SE",
    "chat.meta.stackexchange.com": "Chat.MSE",
};

/**
 * @summary creates a chat hostname switcher button set for the top bar
 * @param {Record<string, string>} hostnames list of valid chat hostnames
 */
const makeChatHostnameSwitcher = (hostnames) => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("network-chat-links");
    wrapper.id = "network-chat-links";

    wrapper.append(
        ...Object.entries(hostnames).map(([hostname, name], i) => {
            const switcher = document.createElement("a");
            switcher.classList.add("button");
            switcher.href = `https://${hostname}`;
            switcher.id = `allrooms${i + 1}`;
            switcher.rel = "noopener noreferrer";
            switcher.textContent = name;

            if (location.hostname === hostname) {
                switcher.classList.add("current-site");
            }

            return switcher;
        })
    );

    return wrapper;
};

/**
 * @summary makes a user profile link for the topbar
 * @param {{ id: string, is_moderator: boolean, name: string }} user current user
 */
const makeUserProfileLink = (user) => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("links-container");

    const linkWrapper = document.createElement("span");
    linkWrapper.classList.add("topbar-menu-links");

    const modDiamond = user.is_moderator ? ' ♦' : '';

    const userAnchor = document.createElement("a");
    userAnchor.href = `/users/${user.id}`;
    userAnchor.title = `${user.name + modDiamond}`;
    userAnchor.textContent = `${user.name + modDiamond}`;

    linkWrapper.append(userAnchor);

    if (user.is_moderator) {
        const modAnchor = document.createElement("a");
        modAnchor.href = `/admin`;
        modAnchor.textContent = "mod";
        linkWrapper.append(modAnchor);
    }

    wrapper.append(linkWrapper);
    return wrapper;
};

/**
 * @summary inserts topbar shared and script-specific styles
 */
const addTopbarStyles = () => {
    const chromeExternalStyles = document.createElement("link");
    chromeExternalStyles.rel = "stylesheet";
    chromeExternalStyles.type = "text/css";
    chromeExternalStyles.href = "https://cdn.sstatic.net/shared/chrome/chrome.css";
    document.head.append(chromeExternalStyles);

    const style = document.createElement("style");
    document.head.append(style);

    const sheet = style.sheet;
    if (!sheet) {
        console.debug(`[Chat Improvements] failed to add topbar styles`);
        return;
    }

    const rules = [
        `#info > .fl,
        #info > .fl + .clear-both,
        #sidebar-menu .button {
            display: none;
        }`,
        `#sidebar {
            padding-top: 40px;
        }`,
        `#chat-body #container {
            padding-top: 50px;
        }`,
        `#sidebar #info #sound {
            margin-top: 3px;
        }`,
        `#sidebar ul, #sidebar ol {
            margin-left: 0;
        }`,
        `.topbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: black;
        }`,
        `.topbar > * {
            opacity: 1;
            transition: opacity 0.4s ease;
        }`,
        `.topbar.js-loading-assets > * {
            opacity: 0;
        }`,
        `.topbar .topbar-wrapper {
            width: auto;
            height: 34px;
            padding: 0 20px;
        }`,
        `.topbar .topbar-links {
            right: 20px;
        }`,
        `.topbar .topbar-icon {
            position: relative;
            cursor: pointer;
        }`,
        `a.topbar-icon .topbar-dialog {
            display: none;
            position: absolute;
            top: 100%;
            cursor: initial;
        }`,
        `a.topbar-icon.topbar-icon-on .topbar-dialog,
        .topbar .topbar-icon.topbar-icon-on .js-loading-indicator {
            display: block !important;
        }`,
        `.topbar .network-chat-links {
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            height: 34px;
            margin-left: 10px;
        }`,
        `.topbar .network-chat-links > a {
            flex: 0 0 auto;
            margin: 0 3px;
            padding: 3px 7px;
            color: white;
            background: #666;
            font-weight: normal;
            text-shadow: none !important;
            border: none;
            border-radius: 4px;
        }`,
        `.topbar .network-chat-links > a:active,
        .topbar .network-chat-links > a:hover {
            background: #444;
            border: none;
        }`,
        `.topbar .network-chat-links > a.current-site {
            background: #3667af !important;
        }`,
        `.topbar .topbar-icon .js-loading-indicator {
            display: none;
            position: absolute;
            top: 100%;
            left: -12px;
            background: white;
            padding: 15px 20px 20px;
        }`,
        `.topbar .topbar-icon .js-loading-indicator img {
            float: left;
        }`,
        `#chat-body #searchbox {
            float: none;
            width: 194px;
            margin: 3px 0 0 20px;
            padding: 2px 3px 2px 24px !important;
            font-size: 13px;
        }`,
        `.topbar-dialog .s-input.s-input__search {
            box-sizing: border-box;
            padding: .6em .7em !important;
            padding-left: 32px !important;
        }`,
        `@media screen and (max-width: 960px) {
            .topbar .network-chat-links {
                display: none;
            }
        }`
    ];

    rules.forEach((rule) => sheet.insertRule(rule));
};

function initTopBar() {

    // If mobile, ignore
    if (CHAT.IS_MOBILE) return;

    addTopbarStyles();

    // If existing topbar exists, only add chat domain switchers
    const existingTopbars = $('#topbar, .topbar');
    if (existingTopbars.length) {
        $(existingTopbars).find(".network-items").after(
            makeChatHostnameSwitcher(chatHostnames)
        );
        return;
    }

    const roomId = CHAT.CURRENT_ROOM_ID;
    const user = CHAT.RoomUsers.current();
    const isMod = CHAT.RoomUsers.current().is_moderator;
    const modDiamond = isMod ? '&nbsp;&#9830;' : '';

    // Remove search due to conflict
    $('#sidebar form').remove();

    // Move notification icon next to title
    $('#sound').prependTo('#roomtitle');

    // Add class to body
    $('#chat-body').addClass('has-topbar');

    const topbar = $(`
<div class="topbar js-loading-assets" id="topbar">
    <div class="topbar-wrapper">

        <div class="js-topbar-dialog-corral"></div>
        <div class="network-items">
            <a class="topbar-icon icon-site-switcher yes-hover js-site-switcher-button"
               data-gps-track="site_switcher.show"
               title="A list of all Stack Exchange sites">
                <span class="js-loading-indicator"><img src="https://stackoverflow.com/content/img/progress-dots.gif" /></span>
                <span class="hidden-text">Stack Exchange</span>
            </a>
            <a class="topbar-icon icon-inbox yes-hover js-inbox-button"
               title="Recent inbox messages">
                <span class="js-loading-indicator"><img src="https://stackoverflow.com/content/img/progress-dots.gif" /></span>
            </a>
            <a class="topbar-icon icon-achievements yes-hover js-achievements-button"
               data-unread-class="icon-achievements-unread"
               title="Recent achievements: reputation, badges, and privileges earned">
                <span class="js-loading-indicator"><img src="https://stackoverflow.com/content/img/progress-dots.gif" /></span>
            </a>
        </div>
        ${makeChatHostnameSwitcher(chatHostnames).outerHTML}
        <div class="topbar-links">
            ${isTranscriptPage() ? "" : makeUserProfileLink(user).outerHTML}
            <div class="search-container">
                <form action="/search" method="get" autocomplete="off">
                    <input name="q" id="searchbox" type="text" placeholder="search" size="28" maxlength="80" />
                    <input name="room" type="hidden" value="${roomId}" />
                </form>
            </div>
        </div>
    </div>
</div>
`).prependTo(`#${isTranscriptPage() ? "transcript" : "chat"}-body`);

    // Highlight current chat domain
    $('#network-chat-links a').filter((i, el) => el.href.includes(location.hostname)).addClass('current-site').attr('title', 'you are here');

    // Move network site rooms button to topbar
    $('#siterooms').appendTo('#network-chat-links');


    // Functions
    function addInboxCount(num) {
        const btn = $('#topbar .js-inbox-button').children('.unread-count').remove().end();
        if (num > 0) {
            btn.prepend(`<span class="unread-count">${num}</span>`);
            btn.children('.topbar-dialog').remove();
            btn.append(`<span class="js-loading-indicator"><img src="https://stackoverflow.com/content/img/progress-dots.gif"></span>`);
        }
    }
    function addRepCount(num) {
        const btn = $('#topbar .js-achievements-button').children('.unread-count').remove().end();
        if (num > 0) {
            btn.prepend(`<span class="unread-count">+${num}</span>`);
            btn.children('.topbar-dialog').remove();
            btn.append(`<span class="js-loading-indicator"><img src="https://stackoverflow.com/content/img/progress-dots.gif"></span>`);
        }
    }
    function addAchievementCount(num) {
        $('#topbar .js-achievements-button').toggleClass('icon-achievements-unread', num > 0);
    }


    /*
     * Modified helper functions to subscribe to live inbox notifications using network ID
     * - with thanks from JC3: https://github.com/JC3/SEUserScripts/blob/master/ChatTopBar.user.js#L280
     */
    const RECONNECT_WAIT_MS = 15000;
    let defAccountId = getAccountId();
    defAccountId.then(function (id) {

        if (id === null) {
            console.log('Not opening WebSocket (no account ID).');
        } else {
            let realtimeConnect = function () {
                //console.log('Opening WebSocket...');
                let ws = new WebSocket('wss://qa.sockets.stackexchange.com');
                ws.onopen = function () {
                    console.log(`WebSocket opened for topbar notifications (your network ID is ${id}).`);
                    ws.send(`${id}-topbar`);
                };
                ws.onmessage = function (event) {
                    if (event && event.data) {
                        try {
                            var tbevent = JSON.parse(event.data);
                            if (tbevent && tbevent.data) {
                                var tbdata = JSON.parse(tbevent.data);
                                console.log(tbdata);
                                if (tbdata.Inbox)
                                    addInboxCount(tbdata.Inbox.UnreadInboxCount);
                                if (tbdata.Achievements && !isNaN(tbdata.Achievements.UnreadRepCount))
                                    addRepCount(tbdata.Achievements.UnreadRepCount);
                                if (tbdata.Achievements && !isNaN(tbdata.Achievements.UnreadNonRepCount))
                                    addAchievementCount(tbdata.Achievements.UnreadNonRepCount);
                            }
                        } catch (e) {
                            // Just ignore, it's a JSON parse error, means event.data wasn't a string or something.
                        }
                    }
                };
                ws.onerror = function (event) {
                    console.log(`WebSocket error: ${event.code} (${event.reason})`);
                };
                ws.onclose = function (event) {
                    console.log(`WebSocket closed: ${event.code} (${event.reason}), will reopen in ${RECONNECT_WAIT_MS} ms.`);
                    window.setTimeout(realtimeConnect, RECONNECT_WAIT_MS);
                };
            };
            realtimeConnect();
        }
    });
    function getAccountId() {
        // If user is not logged in CHAT.CURRENT_USER_ID will be 0.
        return $.Deferred(function (def) {
            if (CHAT.CURRENT_USER_ID === 0) {
                console.log('Cannot get account ID: You are not logged in.');
                def.resolve(null);
                return;
            }
            let server = location.hostname;
            let fkey = $('#fkey').val();
            let account_cached = store.getItem('account');

            if (fkey !== store.getItem(`fkey-${server}`, null) || !account_cached) {
                console.log(`Obtaining parent profile (your chat ID is ${CHAT.CURRENT_USER_ID})...`);
                $.get(`/users/thumbs/${CHAT.CURRENT_USER_ID}`, function (data) {
                    let a = document.createElement('a');
                    a.href = data.profileUrl;
                    let site = a.hostname;
                    let uid = /\/users\/([0-9]+)/.exec(a.pathname)[1];
                    console.log(`Obtaining network ID (your parent ID is ${uid} on ${site})...`);
                    $.get(`//api.stackexchange.com/2.2/users/${uid}?order=desc&sort=reputation&site=${site}&filter=TiTab6.mdk`, function (r) {
                        if (r.items && r.items.length > 0) {
                            store.setItem('account', r.items[0].account_id);
                            store.setItem(`fkey-${server}`, fkey);
                            def.resolve(r.items[0].account_id);
                        }
                    });
                });
            } else {
                def.resolve(account_cached);
            }
        }).promise();
    }


    // Events
    topbar
        .on('click', '.topbar-dialog', function (e) {
            e.stopPropagation();
        })
        .on('click', '.js-site-switcher-button', function () {
            $(this).siblings().removeClass('topbar-icon-on icon-site-switcher-on').children('.topbar-dialog').hide(); // reset others
            if ($(this).children('.topbar-dialog').length == 0) {
                $(this).load(`https://${location.hostname}/topbar/site-switcher`);
            }
            $(this).toggleClass('topbar-icon-on icon-site-switcher-on');
            return false;
        })
        .on('click', '.js-inbox-button', function () {
            $(this).siblings().removeClass('topbar-icon-on icon-site-switcher-on').children('.topbar-dialog').hide(); // reset others
            if ($(this).children('.topbar-dialog').length == 0 || $(this).find('.unread-count').length > 0) {
                $(this).load(`https://${location.hostname}/topbar/inbox`);
            }
            else {
                // clear unread counts?
            }
            $(this).toggleClass('topbar-icon-on');
            return false;
        })
        .on('click', '.js-achievements-button', function () {
            $(this).siblings().removeClass('topbar-icon-on icon-site-switcher-on').children('.topbar-dialog').hide(); // reset others
            if ($(this).children('.topbar-dialog').length == 0 || $(this).find('.unread-count').length > 0) {
                $(this).load(`https://${location.hostname}/topbar/achievements`);
            }
            else {
                // clear unread counts?
            }
            $(this).toggleClass('topbar-icon-on');
            return false;
        })
        .on('keyup', '.js-site-filter-txt', function () {
            const v = this.value.toLowerCase().trim();
            const sites = $('#topbar .js-other-sites li');
            if (v != '') {
                sites.hide().children('a').filter((i, el) => el.hostname.replace('stackexchange.com', '').includes(v) || el.innerText.toLowerCase().includes(v)).parent().show();
            }
            else {
                sites.show();
            }
        })
        .on('mouseover', '.yes-hover', function () {
            if ($(this).siblings().hasClass('topbar-icon-on')) {
                $(this).click();
            }
        });

    function closeTopbarDialogs() {
        $('#topbar .topbar-icon').removeClass('topbar-icon-on icon-site-switcher-on');
    }
    // Hide dialogs when clicking elsewhere
    $('#main, #sidebar, #container').on('click', closeTopbarDialogs);
    // Hide dialogs when pressing esc
    $(document).on('keyup', function (evt) {
        if (evt.keyCode == 27) {
            closeTopbarDialogs();
            $('#searchbox').val(''); // clear searchbox
            $('.highlight').removeClass('highlight'); // clear highlighted messages
        }
    });


    // Jobs
    function getUnreadCounts() {

        // Get and update topbar counts
        $.get(`https://${location.hostname}/topbar/get-unread-counts`, function (data) {
            console.log('topbar counts', data);
            addInboxCount(data.UnreadInboxCount);
            addRepCount(data.UnreadRepCount);
            addAchievementCount(data.UnreadNonRepCount);
        });
    }
    getUnreadCounts();


    // Show topbar after a delay while topbar css is loaded
    setTimeout(() => {
        $('#topbar').removeClass('js-loading-assets');
    }, 2000);

} // End initTopBar


function initRoChangelog() {
    const roomId = Number(location.pathname.match(/\/(\d+)\//).pop());

    // Prepare container
    const logdiv = $('<div id="access-section-owner-log"></div>').appendTo('#access-section-owner');

    // Search for and append room owner changelog
    const searchUrl = `https://${location.hostname}/search?q=to+the+list+of+this&user=-2&room=${roomId}`;
    logdiv.load(searchUrl + ' .messages', function (response) {

        // Add title
        logdiv.prepend('<h4>Room Owner Changelog</h4>');

        // Jump to section again on load if hash present
        if (location.hash == '#access-section-owner') {
            document.getElementById('access-section-owner').scrollIntoView();
        }

        const messages = logdiv.find('.messages').wrap('<div class="monologue"></div>');
        logdiv.find('.content').find('a:last').filter((i, v) => v).replaceWith('<span>list of room owners</span>');
        logdiv.find('.messages a').attr('target', '_blank');

        // Remove invalid entries
        messages.filter((i, el) => !/(has added|has removed).+(to|from) the list of room owners\.$/.test(el.innerText)).remove();
        // Remove empty monologues
        logdiv.children('.monologue:empty').remove();

        // Add indicator icon
        logdiv.find('.content').each(function () {
            $(this).prepend(this.innerText.includes('has removed') ? '<b class="red">-</b>' : '<b class="green">+</b>');
        });

        // Find automatic room owners
        $.get(`https://${location.hostname}/search?q=has+been+automatically+appointed+as+owner+of+this+room.&user=-2&room=${roomId}`, function (response) {
            $('.messages', response).appendTo(logdiv).wrap('<div class="monologue"></div>').find('.content').prepend('<b class="green">+</b>');

            // Add view all link if there is more
            if (messages.length >= 50) logdiv.append(`<div class="monologue" id="more-room-owners"><a href="${searchUrl}" target="_blank">view more</a></div>`);
        });
    });
}


function defaultRepliesLinkRange() {

    // "replies" tab link to default to last 30 days
    const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    $('#tabs a[href="?tab=replies"]').attr('href', (i, v) => v + `&StartDate=${thirtyDaysAgo.getFullYear()}-${thirtyDaysAgo.getMonth() + 1}-${thirtyDaysAgo.getDate()}`);
}


function initUserRecentPagination() {

    const getQueryParam = key => new URLSearchParams(window.location.search).get(key);

    function updatePager(curr) {
        curr = Number(curr);
        if (typeof curr !== 'number') return;

        const qs = location.search.replace(/&page=\d+/, '');
        const pager = $('.pager').empty();

        const start = Math.max(1, curr - 5);
        const stop = Math.max(10, curr + 5);
        const prev = Math.max(1, curr - 1);
        const next = curr + 1;

        let htmlstr = `<a href="https://${location.hostname}${location.pathname}${qs}&page=${prev}" data-page="${prev}"><span class="page-numbers prev">prev</span></a>`;
        for (let i = start; i <= stop; i++) {
            htmlstr += `<a href="https://${location.hostname}${location.pathname}${qs}&page=${i}" data-page="${i}"><span class="page-numbers ${i == curr ? 'current' : ''}">${i}</span></a>`;
        }
        htmlstr += `<a href="https://${location.hostname}${location.pathname}${qs}&page=${next}" data-page="${next}"><span class="page-numbers next">next</span></a>`;

        pager.append(htmlstr);
    }

    function getPage(url, selector, callback = null) {
        window.history.replaceState({}, '', url);

        $.ajax({
            url: url,
            success: function (data) {
                let tmp = $(selector, data);
                $(selector).html(tmp.html());

                if (typeof callback === 'function') callback.call();
            }
        });
    }

    $('.pager').first().remove();

    const content = $('#content');
    const userpage = location.pathname.includes('/users/') && getQueryParam('tab') == 'recent';
    const roomspage = location.pathname.includes('/rooms');
    const pager = $(`<div class="pager clear-both"></div>`).insertAfter('#content');
    pager.clone(true).insertAfter('#content .subheader');

    let curr = getQueryParam('page') || 1;
    updatePager(curr);

    $('.pager').on('click', 'a', function () {
        window.scrollTo(0, 0);
        const num = Number(this.dataset.page);
        getPage(this.href, '#content', function () {
            pager.clone(true).insertAfter('#content .subheader');
            updatePager(num);
            defaultRepliesLinkRange();
        });
        return false;
    });
}


function rejoinFavRooms() {
    $.post(`https://${location.hostname}/chats/join/favorite`, {
        quiet: true,
        immediate: true,
        fkey: fkey
    }, () => console.log('rejoined favourite rooms'));
}


// Our own drag-drop uploader
function initDragDropUploader() {

    const uploadFrame = $(`<iframe name="SOMU-dropUploadFrame" style="display:none;" src="about:blank"></iframe>`).appendTo('body');
    const uploadForm = $(`<form action="/upload/image" method="post" enctype="multipart/form-data" target="SOMU-dropUploadFrame" style="display:none;"></form>`).appendTo('body');
    const uploadField = $(`<input type="file" name="filename" id="filename-input" value="browse" />`).appendTo(uploadForm);
    const uploadSpinner = $(`<div id="uploadSpinner"></div>`).insertAfter($('#input'));

    unsafeWindow.closeDialog = function (imageUrl) {
        sendMessage(imageUrl);
        $('body').children('.wmd-prompt-background, .wmd-prompt-dialog').remove();
        uploadSpinner.hide();
    };
    unsafeWindow.displayUploadError = function (error) {
        console.error(error);
    };

    // Drop handler
    const inputField = $('#input').attr('placeholder', 'drop images here to upload');
    inputField.on('mousedown keydown', ev => {
        // remove placeholder info
        inputField.attr('placeholder', '');
    });
    $('body').on('keydown', ev => {
        // remove placeholder info
        inputField.attr('placeholder', '');
    });
    inputField.get(0).addEventListener('drop', ev => {
        if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length > 0) {
            ev.preventDefault();
            uploadField[0].files = ev.dataTransfer.files;
            uploadSpinner.show();
            uploadForm.submit();
        }
    });
}


function initLiveChat() {
    const roomId = CHAT.CURRENT_ROOM_ID;

    initMessageParser();

    if (CHAT.user.canModerate()) {
        setTimeout(unfreezeRooms, 5000);
    }

    // Rejoin favourite rooms on link click
    let rejoinFavsBtn = $(`<a href="#">rejoin starred</a><span class="divider"> / </span>`).prependTo($('#my-rooms').parent('.sidebar-widget').find('.msg-small').first());
    rejoinFavsBtn.on('click', function () {
        $(this).next('span.divider').addBack().remove();
        rejoinFavRooms();
        return false;
    });

    // If me, rejoin all fav rooms on SO
    if (CHAT.CURRENT_USER_ID == 584192) {
        rejoinFavsBtn.click();
    }

    // If on mobile chat
    if (document.body.classList.contains('mob') || (CHAT && CHAT.IS_MOBILE)) {

        // Rejoin favourite rooms if on mobile
        rejoinFavRooms();

        // Improve room list toggle (click on empty space to close)
        const roomswitcher = $('.sidebar-middle').on('click', function (e) {
            e.stopPropagation();
            if (e.target == roomswitcher) {
                $(document.body).removeAttr('data-panel-visible');
            }
        }).get(0);

        // Open links in a new window
        $('#chat').on('click', '.content a, a.signature', function () {
            $(this).attr('target', '_blank');
        });

        // ignore rest of script
        return;
    }


    /* ===== DESKTOP ONLY ===== */

    // Move stuff around
    $('#footer-legal').prepend('<span> | </span>').prepend($('#toggle-notify'));
    $('#room-tags').appendTo('#roomdesc');
    $('#roomtitle + div').not('#roomdesc').appendTo('#roomdesc');
    $('#sidebar-menu').append(`<span> | <a id="room-transcript" title="view room transcript" href="/transcript/${roomId}">transcript</a> | <a id="room-owners" title="view room owners" href="/rooms/info/${roomId}/?tab=access#access-section-owner">owners</a></span>`);
    addLinksToOtherChatDomains();

    initDragDropUploader();

    // Occasionally reapply changes
    setInterval(reapplyPersistentChanges, 3000);

    // Occasionally update userlist
    setInterval(updateUserlist, 5000); // quick update
    setInterval(() => { updateUserlist(true); }, 30000); // full update

    // Track if userlist has mouse focus, to prevent update if in use
    newuserlist
        .on('mouseover', null, evt => newuserlist.addClass('mouseon'))
        .on('mouseout', null, evt => newuserlist.removeClass('mouseon'));

    // Apply message timestamps to new messages
    applyTimestampsToNewMessages();

    // On any user avatar image error in sidebar, hide image
    $('#present-users').parent('.sidebar-widget').on('error', 'img', function () {
        $(this).hide();
    });

    // Highlight elements with same username on hover
    initUserHighlighter();


    // Sidebar starred messages, show full content on hover
    function loadFullStarredMessage() {
        const el = $(this);
        const mid = Number(this.id.replace(/\D+/g, ''));

        // already fetched or nothing to expand, do nothing (toggle via css)
        if (el.hasClass('js-hasfull') || !/\.\.\.\s*.*\s*- <a rel="noreferrer noopener" class="permalink"/.test(el.html())) return;

        // prefetch stuff
        el.addClass('js-hasfull').contents().filter(function () {
            return this.nodeType === 3 || !/(permalink|relativetime|quick-unstar)/.test(this.className) && this.title == "";
        }).wrapAll(`<div class="message-orig"></div>`);
        el.children('.sidebar-vote').prependTo(el);
        el.children('.message-orig').html((i, v) => v.replace(/\s*-\s*by\s*$/, ''));
        el.children('.permalink').before(`<div class="message-full"><i>loading...</i></div><span> - </span>`).after('<span> by </span>');
        el.children('.quick-unstar').before('<span> </span>');

        // load semi-full message content as displayed in message history
        // - don't get full text using /messages/{rid}/{mid} in case it's a wall of text
        getMessage(mid).then(v => {
            el.children('.message-full').html(v.html);
        });
    }
    // Occasionally check for new sidebar starred messages and load full expanded content
    setInterval(() => {
        $('#starred-posts li').each(loadFullStarredMessage);
    }, 1000);

    // Keep starred posts height calculated based on available height
    const topbar = $('#topbar');
    const sidebar = $('#sidebar');
    const info = $('#info');
    const starred = $('#starred-posts ul');
    const inputArea = $('#input-area');
    const input = $('#input');
    function resizeStarredWidget(evt) {
        const visibleWidgetsHeight = $('#widgets .sidebar-widget:visible').filter((i, el) => $(el).find('#starred-posts').length == 0).map((i, el) => $(el).height()).get().reduce((a, c) => a + c);
        const h = sidebar.height() - info.height() - visibleWidgetsHeight - topbar.height() - inputArea.height() - 80;
        starred.css('max-height', h + 'px');
    }
    setTimeout(resizeStarredWidget, 3000);
    $(window).on('resize', resizeStarredWidget);

    initBetterMessageLinks();


    // Show reply to own messages, as well as links to reply to starred popups in sidebar
    $('#chat').on('click', '.mine .newreply', function () {
        const mid = $(this).closest('.message').attr('id').replace(/\D+/g, '');
        input.val((i, v) => ':' + mid + ' ' + v.replace(/^:\d+\s/, ''));
    });
    $('#starred-posts').on('click', '.reply', function () {
        const mid = $(this).closest('li').attr('id').replace(/\D+/g, '');
        input.val((i, v) => ':' + mid + ' ' + v.replace(/^:\d+\s/, ''));
    });
    function allowReplyToAll() {

        $('.mine .message .meta').not('.js-newreply').addClass('js-newreply').each(function () {
            $(this).append(`<span class="newreply" title="link my next chat message as a reply to this"></span>`);
        });
        $('#starred-posts .quick-unstar').next('.popup').not('.js-newreply').addClass('js-newreply')
            .children('.btn-close').next()
            .after(`<span class="reply"><span class="newreply"> </span> reply to this message</span>`);
    }
    // Occasionally check for new sidebar starred messages and load full expanded content
    setInterval(allowReplyToAll, 1000);
}


function doPageLoad() {
    appendStyles(!document.body.classList.contains('mob'));

    // When viewing user info page in mobile widths
    if (location.pathname.includes('/users/') && $('body').width() < 768) {
        appendMobileUserStyles();
    }

    initTopBar();

    // When joining a chat room
    if (location.pathname.includes('/rooms/') && !location.pathname.includes('/info/')) {
        setTimeout(initLiveChat, 1000);
    }
    // When viewing page transcripts and bookmarks
    else if (location.pathname.includes('/transcript/') || location.pathname.includes('/conversation/')) {
        const roomId = Number(location.pathname.match(/\/(\d+)\/?/).pop());

        // Insert room access button
        const aboutBtn = $('#transcript-links a').eq(1);
        const roBtn = aboutBtn.clone(true, true).insertAfter(aboutBtn).attr('href', (i, v) => v + '?tab=access#access-section-owner').attr('id', 'room-owners-button').text('room owners');
        roBtn.after(`<br><a class="button" href="/rooms/info/${roomId}?tab=stars" id="starred-messages-button">view starred messages</a>`);

        initMessageParser();
        initUserHighlighter();
        setTimeout(initLoadMoreLinks, 2000);

        // Apply our own message reply link scroll-to if message is on same page
        initBetterMessageLinks();
    }
    // When viewing room access tab
    else if (location.pathname.includes('/rooms/info/') && location.search.includes('tab=access')) {
        initRoChangelog();
    }
    // When viewing search results
    else if (location.pathname == '/search' && location.search != '') {

        // Trim non-text chars from beginning and end of query, then match non-word chars in middle
        const query = $('#q').val().toLowerCase().replace(/(^\W+|\W+$)/g, '').replace(/\W+/g, '.{1,3}');
        const regex = new RegExp('(\\s(' + query + ')|(' + query + ')\\s)', 'gi');
        console.log('Highlight query in results:', query);

        // Temporarily replace spaces in URL title attributes
        $('.content a[title]').attr('title', (i, v) => v.replace(/\s/g, '⌂'));

        // Highlight all instances in results that are not oneboxes
        $('.content').filter(function () { return $(this).children('.onebox').length == 0; })
            .html(function (i, v) {
                return v.replace(regex, function (match, p1) { return ` <span class="chat-search-highlight">${p1}</span> `; });
            });

        // Revert spaces in URL title attributes
        $('.content a[title]').attr('title', (i, v) => v.replace(/⌂/g, ' '));
    }
    // When viewing user pages
    else if (/\/users\/\d+/.test(location.pathname)) {

        defaultRepliesLinkRange();

        // If on "recent" page, apply pagination to top and bottom of list
        if (location.search.includes('tab=recent')) {
            initUserRecentPagination();
        }
    }

    // For Sam only
    if (isSuperuser()) {
        $('body').append($(`<style>
a[href*='/triage/']:visited {
    color: navy !important;
}
</style>`));
    }

}


function listenToPageUpdates() {

    // On any page update
    let loaded = false;
    $(document).ajaxComplete(function (event, xhr, settings) {

        // If not a successful ajax call, do nothing
        if (xhr.status == 403 || xhr.status == 500) return;

        // Once: userlist is ready, init new userlist
        if (!loaded && (settings.url.includes('/events') || settings.url.includes('/rooms/pingable'))) {
            loaded = true; // once
            setTimeout(() => { updateUserlist(true); }, 1000);
        }

        // On new message, quick update newuserlist by moving user to front
        if (settings.url.includes('/messages/new')) {
            const clname = $('#chat .user-container').last().attr('class').match(/user-\d+/)[0];
            if (clname) newuserlist.children('.' + clname).prependTo(newuserlist);
        }

        // What does '/rooms/pingable' do? Can ignore this.

        // On new events fetch (on page load and loading older messages), update cache and insert timestamps
        if (settings.url.includes('/events')) {
            processMessageTimestamps(xhr.responseJSON.events);
        }
    });
}


function appendMobileUserStyles() {

    const styles = document.createElement('style');
    styles.setAttribute('data-somu', GM_info?.script.name);
    styles.innerHTML = `
body,
.topbar .topbar-wrapper,
body > #container {
    max-width: 100vw !important;
}
body.outside #container {
    box-sizing: border-box;
}
.topbar,
.topbar .topbar-wrapper {
    height: auto;
}
.topbar .topbar-links {
    position: relative;
}
.topbar .topbar-links .search-container {
    float: right;
    margin-right: 3px;
}
.topbar .topbar-links .search-container input[type=text] {
    margin: 3px 0 0 5px;
    width: 120px;
}
#header {
    margin-top: 72px;
}
#header #hmenu {
    margin-left: 0px;
}
.subheader {
    height: auto;
    border: none;
}
.subheader #tabs a.youarehere {
    font-size: 100%;
}
.subheader #tabs a,
.subheader #tabs .disabled {
    padding: 0 5px;
}
.subheader #tabs {
    float: none;
    margin: 0 auto;
    clear: both;
}
.subheader #tabs:after {
    content: '';
    display: block;
    clear: both;
    position: relative;
    top: -1px;
    border-bottom: 1px solid #666;
    z-index: -1;
}
.subheader h1,
.subheader h2 {
    float: none;
    font-size: 140%;
    line-height: 1.4;
}
div.xxl-info-layout {
    max-width: 100%;
    zoom: 0.85;
}
`;
    document.body.appendChild(styles);

    $('head meta[name=viewport]').remove(); // remove existing viewport tag
    $('head').append(`<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />`);
}


function appendStyles(desktop = true) {

    const mobileStyles = `
/* Hide stuff */
#chat-body.mob #present-users-list {
    display: none !important;
}
/* Increase font sizes */
* {
    font-size: 14px !important;
    line-height: 1.3 !important;
}
html.fixed-header body.with-footer main {
    padding-bottom: 80px;
}
#input-area textarea#input {
    height: calc(2.8em + 24px);
    padding: 5px 8px !important;
}
#header .title {
    overflow: hidden;
}
/* Increase size of reply link icons */
#chat .monologue .message .reply-info {
    width: 18px;
    height: 15px;
    margin-left: -4px;
    margin-right: 2px;
    padding: 0;
    transform: scale(1.2, 1.2);
}
/* Reduce size of timestamps */
.mob #chat .tiny-signature .username a,
.mob #chat .monologue .timestamp {
    font-size: 12px !important;
}
#present-users li {
    height: 38px !important;
    overflow: hidden;
}
.quote {
    padding: 5px 0 5px 10px;
}
`;

    const desktopStyles = `
/* Sidebar scrollbar */
#sidebar::-webkit-scrollbar{width:6px;height:6px;}
#sidebar::-webkit-scrollbar-thumb{background-color:rgb(196, 196, 196); border-radius: 5px;}
#sidebar::-webkit-scrollbar-thumb:hover{background-color:rgb(196, 196, 196);}
#sidebar::-webkit-scrollbar-track{background-color:rgba(0, 0, 0, 0.05);}

#allrooms,
#transcript-body #sidebar #info > div > a:first-child {
    margin-right: 5px;
}
#sound + div.fl {
    margin-bottom: 5px;
}

/* Reduce room description until mouseover */
#roomdesc {
    position: absolute;
    z-index: 2;
    width: calc(100% - 24px);
    height: 20px;
    padding: 0 !important;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#roomtitle:hover + #roomdesc,
#roomdesc:hover {
    height: auto;
    padding-bottom: 20px !important;
    border-bottom: 1px dotted #cfcfcf;
    background: white;
    color: #333;
    white-space: unset;
}
#sidebar #info #roomtitle {
    position: relative;
    margin-bottom: 0;
    padding-bottom: 5px;
    padding-right: 18px;
    line-height: 1.2em;
}
#roomdesc + #room-tags {
    display: none;
}
#roomdesc ~ #sidebar-menu {
    margin-top: 30px !important;
}
#roomdesc > div,
#roomdesc a.button {
    display: none;
}
#roomtitle:hover + #roomdesc > div,
#roomdesc:hover > div {
    display: block;
}

/* New AMA chatroom UI */
.sidebar-widget.wmx3 .s-card {
    border: none;
    padding: 0;
}
.wxm3 .present-users-list {
    border: 0;
}
#cp-sb-std-jobs {
    display: none;
}

/* Increase height of textbox */
#bubble {
    position: relative;
    height: 87px;
}
#input-area {
    height: 100px;
}
#input {
    height: 88px;
    padding: 3px 4px;
    padding-right: 26px;
}
#tabcomplete-container {
    bottom: 87px;
}

/* Always use tiny (compact) signatures */
.monologue .tiny-signature {
    display: block !important;
}
.monologue .tiny-signature ~ * {
    display: none !important;
}

/* Custom scrollbars (mostly for Windows) */
.sidebar-widget *::-webkit-scrollbar { width: 2px; height: 5px; }
.sidebar-widget *::-webkit-scrollbar-thumb { background-color: #ccc; border-radius: 5; }
.sidebar-widget *::-webkit-scrollbar-track { background-color: transparent; }
.sidebar-widget *:hover::-webkit-scrollbar { width: 5px; }
.sidebar-widget *:hover::-webkit-scrollbar-thumb { background-color: #aaa; }


/* Other minor stuff */
#loading #loading-message {
    top: 40%;
    left: 50%;
    right: unset;
    height: unset;
    width: unset;
    max-width: 600px;
    transform: translate(-50%, -50%);
}
#chat-body #container {
    padding-left: 10px;
    padding-right: 10px;
    box-sizing: border-box;
}
#sidebar #info #roomtitle #toggle-favorite {
    position: absolute;
    top: 0;
    right: 0;
    margin-top: 2px;
}
#sidebar .sprite-sec-private,
#sidebar .sprite-sec-gallery {
    margin-right: 1px;
}
#chat-body #searchbox,
#transcript-body #searchbox {
    width: 150px;
    margin-top: -1px;
    padding: 2px 5px;
}
ul#my-rooms .quickleave {
    float: left;
    margin: 4px 3px 0 0;
}
ul#my-rooms > li > a {
    display: inline-block;
    max-width: calc(100% - 15px);
    margin: 3px 0 -5px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
ul#my-rooms > li > a span {
    display: none;
}
.monologue {
    min-width: 300px;
}
.message a i.transcript-link {
    opacity: 0.5;
    font-size: 0.9em;
}
#transcript-links #room-owners-button {
    margin-left: 8px;
}
#transcript-body #sidebar-content .room-mini + div .tag {
    display: none;
}
.pager .page-numbers {
    min-width: 14px;
    margin-bottom: 3px;
}


/* Full message previews on hover */
#starred-posts .js-hasfull {
    min-height: 28px;
}
#starred-posts .message-full,
#starred-posts .js-hasfull:hover .message-orig {
    display: none;
}
#starred-posts .message-orig,
#starred-posts .js-hasfull:hover .message-full {
    display: inline;
}
#starred-posts ul.collapsible {
    max-height: 35vh;
    margin-right: -10px;
    padding-right: 10px !important;
    overflow-y: scroll;
}
#starred-posts ul.collapsible.expanded {
    max-height: 50vh !important;
    padding-right: 3px;
    padding-bottom: 50px;
    overflow-y: scroll;
}


/* Highlight links of user on any mouse hover */
#chat .signature.js-user-highlight .username,
#chat .mention.js-user-highlight,
#chat .mention-others.js-user-highlight,
#transcript .signature.js-user-highlight .username,
#transcript .mention.js-user-highlight,
#transcript .mention-others.js-user-highlight,
#present-users .user-container.js-user-highlight .username,
#present-users-list .user-container.js-user-highlight .username,
#chat-body #sidebar #starred-posts a.js-user-highlight {
    background-color: yellow;
    color: #222;
}
#present-users-list .inactive.js-user-highlight {
    opacity: 1 !important;
}
.monologue .tiny-signature .username {
    /*height: unset !important;*/
    margin-top: 3px;
}


/* New userlist */
#present-users {
    height: 1px;
    margin: 0 0 -1px;
    padding: 0;
    border: 0;
    opacity: 0;
    visibility: hidden;
    overflow: hidden;
}
#present-users-list {
    position: relative;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-start;
    align-content: flex-start;
    align-items: flex-start;

    max-height: 300px;
    overflow-y: auto;
    padding-bottom: 16px;
    border-bottom: 1px dotted #cfcfcf;
    list-style: none;
    font-size: 8.8px;
    color: inherit;
}
#present-users-list li {
    flex: 1 0 50%;
    align-self: auto;

    position: relative;
    min-width: 80px;
    margin: 0 0 -14px;
    padding: 7px 0;
    opacity: 1 !important;
    background-color: transparent !important;
    z-index: 1;

    -webkit-column-break-inside: avoid;
              page-break-inside: avoid;
                   break-inside: avoid;
}
#present-users-list:hover li.inactive {
    display: block !important;
}
#present-users-list li:hover {
    color: #000;
    z-index: 2;
}
#present-users-list:hover li.inactive {
    opacity: 1 !important;
}
#present-users-list li.inactive {
    opacity: 0.5 !important;
}
#present-users-list li .avatar {
    position: relative;
    display: inline-block;
    width: 16px;
    height: 16px;
}
#present-users-list li .avatar img {
    position: absolute;
    width: 16px;
    height: 16px;
    background-color: white;
    font-size: 0; /* hides broken images alt text */
}
#present-users-list li:hover .avatar img {
    width: 24px;
    height: 24px;
    margin-top: -4px;
    margin-left: -4px;
    box-shadow: 0 0 2px 1px rgba(0,0,0,0.2);
}
#present-users-list .username {
    display: inline-block;
    min-width: 58px;
    width: calc(100% - 24px);
    height: 1.3em;
    margin-left: 5px;
    padding-right: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#present-users-list .username + .username {
    display: none;
}
#present-users-list > .users-count {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 6px;
    font-size: 0.9em;
    color: inherit;
}
#present-users-list > .users-count:after {
    content: ' users';
}

.ob-image,
.ob-image img {
    max-width: unset;
    max-height: 400px;
}

div.message .meta {
    min-width: 40px;
    text-align: right;
}
#chat-body .monologue.mine:hover .message:hover .meta {
    display: inline-block !important;
}
#chat-body .monologue.mine .message .meta .flags,
#chat-body .monologue.mine .message .meta .stars {
    display: none;
}

@media screen and (max-width: 700px) {
    #present-users {
        height: auto;
        margin: 0 0 5px;
        padding: 0 0 5px;
        border-bottom: 1px dotted #cfcfcf;
        opacity: 1;
        visibility: visible;
        overflow: auto;
    }
    #present-users > .present-user,
    #present-users .more,
    #present-users .user-gravatar32 {
        height: 22px;
        width: 22px !important;
    }
    #present-users-list {
        display: none;
    }
}
@media screen and (max-width: 1033px) {
    #footer-legal,
    #footer-logo,
    #input-table td[rowspan="2"][width] {
        display: none;
    }
    #input,
    #input-table td.chat-input {
        width: 100%;
    }
    #chat-body .monologue .signature {
        width: 100%;
        display: block;
        float: none;
    }
    #chat-body .monologue .signature:after {
        content: '';
        display: table;
        clear: both;
    }
    #chat-body .monologue .signature * {
        float: left;
        text-align: left;
    }
    #chat-body .monologue .tiny-signature {
        padding: 0 0 4px 0;
    }
    #chat-body .monologue .tiny-signature .avatar {
        margin: 0 5px 0 0;
    }
    #chat-body .monologue .messages {
        width: calc(100% - 30px);
    }
}
@media screen and (max-width: 1600px) {
    #my-rooms {
        max-height: 90px;
        overflow-y: auto;
        margin-right: -10px;
        padding-right: 5px !important;
    }
    #my-rooms .activity-5 .room-info,
    #my-rooms .activity-6 .room-info {
        display: none;
    }
    #my-rooms li:first-child .room-info {
        display: block !important;
    }
    .fr {
        margin: 5px 0;
    }
}
@media screen and (max-width: 1200px) {
    #my-rooms .activity-3 .room-info,
    #my-rooms .activity-4 .room-info {
        display: none;
    }
    .fr {
        margin: 0 0;
    }
}
@media screen and (min-width: 1000px) {
    #present-users-list {
        max-height: none;
        overflow: visible;
        font-size: 0.9em;
    }
    #present-users-list li { flex-grow: 0; flex-basis: 33.33%; }
}
@media screen and (min-width: 1400px) {
    #present-users-list li { flex-basis: 25%; }
    #main { width: 65%; }
    #sidebar { width: 33%; }
}
@media screen and (min-width: 1600px) {
    #present-users-list li { flex-basis: 20%; padding: 8px 0; }
}

/* Hide extra inactive users until userlist is focused */
@media screen and (max-width: 999px) {
   #present-users-list li.inactive:nth-child(n + 15) {
       display: none;
   }
}
@media screen and (max-width: 1339px) {
   #present-users-list li.inactive:nth-child(n + 25) {
       display: none;
   }
}
@media screen and (max-width: 1400px) {
   #present-users-list li.inactive:nth-child(n + 31) {
       display: none;
   }
}
@media screen and (max-width: 1600px) {
   #present-users-list li.inactive:nth-child(n + 41) {
       display: none;
   }
}
@media screen {
   #present-users-list li.inactive:nth-child(n + 51) {
       display: none;
   }
}
`;

    const generalStyles = `
/* Show mods with diamonds */
#chat-body .signature .username.moderator {
    color: #4979b9;
}
#chat-body .signature .username.moderator:after {
    content: ' ♦';
}
#chat-body .signature .username.moderator > span[style*="float"] {
    display: none;
}

/* Fix size of avatars in case they don't load */
.avatar-16 {
    width: 16px;
    height: 16px;
    overflow: hidden;
}
.avatar-32 {
    width: 32px;
    height: 32px;
    overflow: hidden;
}
.monologue .signature .avatar-32 {
    float: right;
}
.monologue .signature .avatar-32 + .username {
    clear: both;
    margin-bottom: 2px;
}
.system-message-container {
    margin: 15px 0px;
}

/* No wrap chat transcript links, unless in sidebar */
a.nowrap {
    white-space: nowrap;
}
#sidebar a.nowrap {
    white-space: initial;
}

/* Break all links in expanded room mini infobox */
.room-mini-description a {
    word-break: break-all;
}

/* RO changelog */
#access-section-owner-log {
    margin: 10px 0;
    padding-bottom: 32px;
}
#access-section-owner-log h4 {
    margin-bottom: 5px;
}
#access-section-owner-log .flash {
    display: none;
}
#access-section-owner-log .message .content b:first-child {
    display: inline-block;
    width: 20px;
    text-align: center;
}
#access-section-owner-log b.green {
    color: green !important;
}
#access-section-owner-log b.red {
    color: red !important;
}
body.outside .access-section h2 {
    margin-bottom: 5px;
}
.access-section .access-list {
}
.access-section .access-list:after {
    content: "";
    display: table;
    clear: both;
}

/* Message replies dialog */
.dialog-message {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 24px;
    right: 0;
    background: #222;
    color: #eee;
    padding: 7px 12px;
    margin: -7px -12px;
    border-radius: 7px;
    z-index: 1;
}
.dialog-message.highlight {
    background: #222 !important;
}
.dialog-message .mention {
    color: var(--black);
}
.dialog-message > .action-link {
    left: -12px !important;
    top: 0;
    color: #f6f6f6 !important;
    background-color: #767676;
}
.dialog-message > .action-link .img.menu {
    background-image: url('https://cdn-chat.sstatic.net/chat/Img/sprites.png');
    background-repeat: no-repeat;
    background-position: top left;
    background-position: 2px -286px;
    width: 16px;
    height: 13px;
    margin-top: 2px;
}
div.dialog-message > .meta {
    display: block !important;
    background-color: #222;
    border-radius: 5px;
}

/* Chat search highlight keyword */
.chat-search-highlight {
    color: black;
    font-weight: bold;
    background: yellow;
}

/* Improve pagination UI */
#roomlist {
    clear: both;
}
#roomlist .pager,
#roomlist .fr {
    display: inherit;
}
.pager {
    margin: 0;
    padding: 30px 0;
    text-align: center;
    clear: both !important;
}
.pager > * {
    float: none !important;
    display: inline-block !important;
    margin: 0 2px;
    padding: 0;
}
.pager .page-numbers {
    margin: 0;
    padding: 3px 7px;
    border-radius: 3px;
}
#content .subheader ~ div:last-of-type > div[style*="float:left; width:230px"] {
    position: sticky;
    top: 10px;
}
.room-mini {
    min-height: 110px;
}

/* Drag-drop uploader */
body.dragging #dropTarget {
    display: block;
}
#dropTarget {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.6);
    z-index: 999999;
}
#dropTarget span {
    display: block;
    text-align: center;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-size: 24px;
    text-shadow: 1px 1px black;
}
#uploadSpinner {
    display: none;
    background: transparent url(//cdn.sstatic.net/Img/progress-dots.gif) center no-repeat;
    width: 18px;
    height: 18px;
    position: absolute;
    top: 7px;
    left: 14px;
}

/* Reply to starred messages */
#sidebar .reply {
    display: block;
    margin-bottom: 10px;
    line-height: 18px;
}
#sidebar .newreply {
    display: inline-block;
    background-image: url('https://cdn-chat.sstatic.net/chat/Img/sprites.png');
    background-repeat: no-repeat;
    background-position: top left;
    background-position: 0 -44px;
    width: 10px;
    height: 10px;
    cursor: pointer;
}

@media screen and (min-width: 768px) {
    #chat-body .monologue .signature {
        width: 11%;
    }
    #chat-body .signature .username.moderator {
        position: relative;
        padding-right: 0.8em;
    }
    #chat-body .signature .username.moderator:after {
        content: '♦';
        position: absolute;
        top: 0;
        right: 0;
        font-size: 1.2em;
    }
}
`;

    const printStyles = `
@media print {

    html, body {
        max-width: 780px;
    }
    body {
        font-size: 11px;
        background-color: #fff;
        background-image: none;
    }

    body > span[style*="absolute"],
    #topbar,
    .topbar,
    #feed-ticker,
    #bottom,
    #input-area,
    #sound,
    input,
    button,
    .button,
    #container > a,
    #container > br,
    #widgets > .sidebar-widget:nth-child(2),
    #widgets > .sidebar-widget:last-child,
    #sidebar .more,
    #sidebar .user-currentuser,
    #sidebar .js-hasfull .message-orig,
    #sidebar #room-ad,
    #toggle-favorite,
    #transcript-body #info br,
    #transcript-body .room-mini ~ br,
    #transcript-body .room-mini .mspbar.now,
    #transcript-body #info .tag,
    #transcript-body #transcript-logo,
    #transcript-body #copyright,
    #transcript-body .action-link,
    #transcript-body .transcript-nav,
    .monologue .avatar,
    .message-controls,
    .message > .action-link,
    .message > .meta,
    .username .name + br,
    .username .pronouns
    {
        display: none;
    }

    #sidebar #info #roomdesc > div,
    #starred-posts > div > ul > li,
    .ob-message.js-onebox-hidden,
    #chat .monologue:first-child .js-dynamic-timestamp
    {
        display: block;
    }

    #sidebar .js-hasfull .message-full
    {
        display: inline;
    }

    #main {
        display: flex;
        flex-direction: column-reverse;
        width: 100%;
    }
    #sidebar {
        position: relative;
        width: auto;
        margin: 10px 0 20px;
        padding: 10px;
        border: 1px dotted black;
    }
    #transcript-body #container {
        padding: 0;
    }
    #transcript-body #sidebar {
        margin-top: 0;
        margin-bottom: -10px;
    }
    #sidebar #info #roomdesc {
        position: relative;
        height: auto;
        padding-bottom: 0;
        border: none;
        background: transparent;
        white-space: unset;
    }
    #sidebar #info #roomdesc + #sidebar-menu {
        margin-top: 10px;
    }
    #sidebar #present-users-list {
        max-height: none;
        overflow: visible;
        color: #000;
    }
    #sidebar #present-users-list li {
        flex: 0 0 20%;
    }
    #sidebar #present-users-list li.inactive {
        opacity: 0.7;
    }
    #sidebar #starred-posts ul.collapsible,
    #sidebar #starred-posts ul.collapsible.expanded {
        max-height: none;
        padding-bottom: 0;
        overflow: visible;
    }
    #chat-body #container {
        padding-top: 0;
    }
    #chat {
        padding-bottom: 20px;
    }
    .monologue {
        display: table;
        page-break-inside: avoid;
        width: calc(100% - 26px);
        margin: 0;
        padding: 0;
    }
    .monologue,
    .system-message-container {
        padding-top: 15px;
        margin-bottom: -15px;
    }
    .monologue .signature {
        flex: 0 1 120px;
        margin-right: 8px;
    }
    .monologue .tiny-signature .username {
        height: 1.1em;
    }
    .monologue .messages {
        flex: 1 0 80%;
        border-color: #f2f2f2;
        background-color: #f8f8f8;
    }
    div.message.reply-parent,
    div.message.reply-child {
        border-color: #f2f2f2;
        background-color: #f8f8f8;
    }
    .monologue.catchup-marker {
        padding-top: 0;
        border-top: none;
    }
    #chat .message {
        display: flex;
    }
    .message {
        page-break-inside: avoid;
        border: none;
    }
    .message .content {
        flex: 1 1 100%;
        padding-right: 52px;
    }
    .message .mention {
        background-color: transparent;
    }
    div.message {
        padding-left: 15px;
    }
    div.message .full,
    div.message .partial {
        max-height: none;
    }
    #chat .messages .timestamp,
    #chat .message.cmmt-deleted span.deleted {
        position: absolute;
        right: 38px;
    }
    .stars .img {
        filter: saturate(0) grayscale(1) brightness(0);
    }
    #transcript-body .pager {
        text-align: center;
    }
    #transcript-body .pager > * {
        float: none;
        display: inline-block;
    }
    #transcript-body .pager .page-numbers {
        margin-bottom: 3px;
    }

    /* SOMU - Chat Transcript Helper - switch back to original timestamp (UTC) */
    .page-numbers[data-orig-text],
    .timestamp[data-orig-timestamp] {
        font-size: 0;
    }
    .page-numbers[data-orig-text]:before,
    .timestamp[data-orig-timestamp]:before {
        content: attr(data-orig-timestamp);
        font-size: 9px;
        white-space: nowrap;
    }
    .page-numbers[data-orig-text]:before {
        content: attr(data-orig-text);
        font-size: 14px;
    }

    /* Chat Transcript - room mini - expand full description */
    #transcript-body #info .room-mini {
        width: auto;
        margin-bottom: 15px;
    }
    #transcript-body #info .room-mini .room-mini-description {
        font-size: 0;
    }
    #transcript-body #info .room-mini .room-current-user-count,
    #transcript-body #info .room-mini .room-message-count {
        display: none;
        width: auto;
        font-size: 11px;
    }
    #transcript-body #info .room-mini .room-current-user-count:before,
    #transcript-body #info .room-mini .room-message-count:before,
    #transcript-body #info .room-mini .room-mini-description:before {
        display: inline-block;
        content: attr(title);
        margin-right: 3px;
        font-size: 11px;
        word-break: break-word;
    }

    /* Chat Transcript - convert calendar to text with year */
    #transcript-body #info > h2 {
        display: inline-block;
    }
    #transcript-body #info .icon .calendar,
    #transcript-body #info .calendar-small-link {
        display: none;
    }
    #transcript-body #info .icon {
        display: inline-block;
        float: none;
        font-size: 0;
    }
    #transcript-body #info .icon:before {
        content: attr(title);
        font-size: 16.5px;
        font-weight: bold;
    }

}
`.replace(/ !important/g, '').replace(/;/g, ' !important;');


    // Add general styles
    const styles_general = document.createElement('style');
    styles_general.setAttribute('data-somu', GM_info?.script.name);
    styles_general.innerHTML = generalStyles;
    document.body.appendChild(styles_general);


    // Add print styles
    const styles_print = document.createElement('style');
    styles_print.setAttribute('data-somu', GM_info?.script.name);
    styles_print.innerHTML = printStyles;
    document.body.appendChild(styles_print);


    // Add device-specific styles
    const styles_device = document.createElement('style');
    styles_device.setAttribute('data-somu', GM_info?.script.name);
    styles_device.innerHTML = desktop ? desktopStyles : mobileStyles;
    document.body.appendChild(styles_device);
}


// On page load
doPageLoad();
listenToPageUpdates();
