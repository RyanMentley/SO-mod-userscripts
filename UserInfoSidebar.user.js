// ==UserScript==
// @name         User Info Sidebar
// @description  Adds user moderation links sidebar with quicklinks & user details (from Mod Dashboard) to user-specific pages
// @homepage     https://github.com/samliew/SO-mod-userscripts
// @author       @samliew
// @version      3.2
//
// @include      https://*stackoverflow.com/*
// @include      https://*serverfault.com/*
// @include      https://*superuser.com/*
// @include      https://*askubuntu.com/*
// @include      https://*mathoverflow.net/*
// @include      https://*.stackexchange.com/*
//
// @include      https://chat.stackexchange.com/*
// @include      https://chat.meta.stackexchange.com/*
// @include      https://chat.stackoverflow.com/*
//
// @exclude      https://stackoverflow.com/c/*
// @exclude      */admin/user-activity*
// @exclude      */admin/dashboard*
//
// @require      https://raw.githubusercontent.com/samliew/SO-mod-userscripts/master/lib/common.js
//
// @grant        GM_xmlhttpRequest
// ==/UserScript==

/* globals StackExchange, GM_info */

'use strict';

// Moderator check
if (!isModerator()) return;

const isChat = location.hostname.includes('chat.');


function getChatParentUser() {
    const parentuser = $('.user-stats a').last().attr('href');
    return parentuser ? 'https:' + parentuser : '';
}

function getCurrentUserId() {

    // Mod & CM messages
    if (location.pathname.includes('/users/message/') || location.pathname.includes('/admin/cm-message/')) {
        return location.pathname.match(/\d+/)[0];
    }

    // User & user admin pages
    if (document.body.classList.contains('user-page') || (/[/-]users?[/-]/.test(location.href)) && document.body.classList.contains('mod-page')) {
        return location.href.match(/\d+/)[0];
    }

    // Chat
    if (isChat && location.pathname.includes('/users/')) {
        const parentuser = getChatParentUser();
        return parentuser ? parentuser.match(/\d+/)[0] : null;
    }

    // Question asker
    const questionUser = $('#question .post-signature:last a[href*="/users/"]').first();
    if (questionUser.length !== 0) {
        return questionUser.attr('href').match(/\d+/)[0];
    }

    // Default
    return null;
}


function doPageLoad() {
    const uid = getCurrentUserId();
    console.log(`Current User: ${uid}`);

    // User not found, do nothing
    if (!uid) return;

    if (isChat) {

        const userModPage = getChatParentUser().replace('/users/', '/users/account-info/').replace(/\D+$/, '');
        const mainSiteHostname = userModPage.split('/users/')[0];

        ajaxPromise(userModPage, 'document').then(function (data) {
            const username = $('h1', data).first().get(0).childNodes[0].nodeValue.trim();

            // Modify quicklinks and user details, then append to page
            const $quicklinks = $('div.mod-links', data).attr('id', 'usersidebar');
            const $modActions = $quicklinks.find('.mod-actions');

            // Move contact links
            $modActions.find('li').slice(-4, -2).appendTo($quicklinks.find('ul:first'));

            // Remove other actions as they need additional work to get popup working
            $modActions.last().remove();

            // Headers
            const $infoHeader = $quicklinks.find('h3').last().text(username).prependTo($quicklinks);

            // Insert user details
            const $info = $('.mod-section .details', data).insertAfter($infoHeader);
            $info.children('.row').each(function () {
                $(this).children().first().unwrap();
            });

            // Transform user details to list format
            $info.children('.col-2').removeClass('col-2').addClass('info-header');
            $info.children('.col-4').removeClass('col-4').addClass('info-value');

            // Change xref link to month to be more useful (default was week)
            $quicklinks.find('a[href*="xref-user-ips"]').attr('href', (i, v) => v += '?daysback=30&threshold=2');

            // Prepend Mod dashboard link
            $quicklinks.find('ul').prepend(`<li><a href="/users/account-info/${uid}">mod dashboard</a></li>`);

            // Since we are on chat, transform links to main links
            $('a[href^="/"]', $info).attr('href', (i, v) => mainSiteHostname + v);
            $('.mod-quick-links a', $quicklinks).attr('href', (i, v) => mainSiteHostname + v);

            // Check if user is currently suspended, highlight username
            const susMsg = $('.system-alert', data).first().text();
            if (susMsg.indexOf('suspended') >= 0) {
                const susDur = susMsg.split('ends')[1].replace(/(^\s|(\s|\.)+$)/g, '');
                $quicklinks.find('h3').first().attr({ style: 'color: var(--red-500) !important;' }).attr('title', `currently suspended (ends ${susDur})`);
            }

            // Append to page
            $('body').append($quicklinks);
        });

        // Handle resize
        $(window).on('load resize', function () {
            $('body').toggleClass('usersidebar-open', $(document).width() >= 1400);
        });

    }
    // Not chat
    else {

        // Expand user info
        $('.js-expandable-overflow-btn:not(.v-hidden)').click();

        // Fix user profile tab/pills taking up too much space
        $('.js-user-header .s-navigation--item[href^="/users/account-info/"]').text('Dashboard');
        $('.js-user-header .s-navigation--item[href^="/users/edit/"]').text('Edit');
        $(`.js-user-header a[href^="https://meta.${location.hostname}/users/"] .ml4`).text('Meta');
        $(`.js-user-header a[href^="https://stackexchange.com/users/"]`).html((i, v) => v.replace(/\s+Network profile\s+/, 'Network'));
        $('.js-user-header > div .fs-body3').addClass('fw-bold');

        // If on user dashboard page
        if (location.pathname.includes('/users/account-info/')) {
            return;
        }

        // Get user's mod dashboard page
        $.get('/users/account-info/' + uid, function (data) {

            // If deletion record not found, do nothing
            if (data.includes('Could not find a user or deletion record')) return;

            // Get username
            const username = $('h1', data).first().get(0).childNodes[0].nodeValue.trim();

            // Modify quicklinks and user details, then append to page
            const $quicklinks = $('div.mod-links', data).attr('id', 'usersidebar');
            const $modActions = $quicklinks.find('.mod-actions');

            // Move contact links
            $modActions.find('li').slice(-4, -2).appendTo($quicklinks.find('ul:first'));

            // Remove other actions as they need additional work to get popup working
            $modActions.last().remove();

            // Headers
            const $infoHeader = $quicklinks.find('h3').last().text(username).prependTo($quicklinks);

            // Insert user details
            const $info = $('.mod-section .details', data).insertAfter($infoHeader);
            $info.children('.row').each(function () {
                $(this).children().first().unwrap();
            });

            // Transform user details to list format
            $info.children('.col-2').removeClass('col-2').addClass('info-header');
            $info.children('.col-4').removeClass('col-4').addClass('info-value');

            // Change xref link to month to be more useful (default was week)
            $quicklinks.find('a[href*="xref-user-ips"]').attr('href', (i, v) => v += '?daysback=30&threshold=2');

            // Prepend Mod dashboard link
            $quicklinks.find('ul').prepend(`<li><a href="/users/account-info/${uid}">mod dashboard</a></li>`);

            // If on meta,
            if (StackExchange.options.site.isMetaSite) {
                // enable contact user link
                $('.mod-quick-links span.disabled', $quicklinks).replaceWith(`<a title="use to contact this user and optionally suspend them" href="/users/message/create/${uid}">contact user</a>`);

                // change links to main
                $('.mod-quick-links a', $quicklinks).attr('href', (i, v) => StackExchange.options.site.parentUrl + v);
            }

            // Check if user is currently suspended, highlight username
            const susMsg = $('.system-alert', data).first().text();
            if (susMsg.indexOf('suspended') >= 0) {
                const susDur = susMsg.split('ends')[1].replace(/(^\s|(\s|\.)+$)/g, '');
                $quicklinks.find('h3').first().attr({ style: 'color: var(--red-500) !important;' }).attr('title', `currently suspended (ends ${susDur})`);
            }

            // Add links to all three chat domains
            const chatlinkSO = $info.find('a[href^="https://chat."]').text('SO').attr('href', function (i, href) {
                return href.replace('//accounts', '/accounts').replace(/(?:meta\.)?stackexchange\.com/, 'stackoverflow.com');
            }).addClass('d-inline-block mr12 fs-body2');

            const chatlinkSE = chatlinkSO.clone(true).attr('href', function (i, href) {
                return href.replace('stackoverflow.com', 'stackexchange.com');
            }).text('SE').insertAfter(chatlinkSO);

            const chatlinkMSE = chatlinkSO.clone(true).attr('href', function (i, href) {
                return href.replace('stackoverflow.com', 'meta.stackexchange.com');
            }).text('MSE').insertAfter(chatlinkSE);

            // Links open in new tab
            $quicklinks.find('a').attr('target', '_blank');

            // Append to page
            $('body').append($quicklinks);
        });

        // Handle resize
        $(window).on('load resize', function () {
            $('body').toggleClass('usersidebar-open', $(document).width() >= 1720);
        });
    }
}


// On page load
setTimeout(doPageLoad, 100);


// Append styles
const styles = document.createElement('style');
styles.setAttribute('data-somu', GM_info?.script.name);
styles.innerHTML = `
.s-table th, .s-table td {
    padding: 3px;
}
.js-profile-mod-info table td.mod-label {
    font-weight: bold;
}

/* copied from main site as chat doesn't have this style */
.mod-links li {
    margin-bottom: 5px;
}
.bounty-indicator-tab {
    color: var(--white) !important;
    display: inline;
    background-color: var(--blue-500);
    padding: .2em .5em .25em;
    margin-right: 5px;
    font-size: 10px;
    line-height: 1.3;
    border-radius: 2px;
}


#usersidebar * {
    box-sizing: border-box;
}
#usersidebar {
    position: fixed;
    z-index: 8950;
    top: 44px;
    right: 100%;
    width: 230px;
    max-height: calc(100vh - 50px);
    padding: 10px 12px 0;
    background: var(--white);
    opacity: 0.7;
    border: 1px solid var(--black-150);
    box-shadow: 2px 2px 14px -3px rgba(0,0,0,0.25);
}
#usersidebar:after {
    content: 'user';
    position: absolute;
    left: 100%;
    top: 5px;
    width: 40px;
    height: 30px;
    padding: 5px 8px;
    background: var(--white);
    border: 1px solid var(--black-150);
    border-left: none;
    box-shadow: 3px 2px 10px -2px rgba(0,0,0,0.25);
    box-sizing: border-box;
}
.usersidebar-open #usersidebar,
#usersidebar:hover {
    left: -1px;
    right: initial;
    opacity: 1;
}
.usersidebar-open #usersidebar {
    top: 50px;
    box-shadow: none;
}
.usersidebar-open #usersidebar:after {
    display: none;
}
#usersidebar .profile-section-title {
    margin-bottom: 15px !important;
    padding-left: 0px !important;
}
#usersidebar .details {
    margin-bottom: 15px;
}
#usersidebar .details .info-header {
    font-size: 0.95em;
    font-style: italic;
    color: var(--black-500);
}
#usersidebar .details .info-value {
    margin-bottom: 10px;
}
#usersidebar .details > div:nth-child(-n + 2),
#usersidebar .details > div:nth-child(n+7):nth-child(-n+8),
#usersidebar .details > div:nth-child(n+13):nth-child(-n+14),
#usersidebar .details > div:nth-child(n+19) {
    display: none;
}
#usersidebar .details a[href^="https://stackexchange.com/users/"] {
    font-size: 1.15384615rem; // .fs-body2
}
.mod-quick-links .bounty-indicator-tab {
    float: left;
    margin-right: 4px !important;
}

/* Fullscreen snippets always on top */
.snippet.expanded-snippet {
    z-index: 9999999 !important;
}

@media screen and (max-height: 740px) {
    #usersidebar {
        top: 0px !important;
        max-height: 100vh;
    }
    #usersidebar:after {
        top: 49px;
    }
    #usersidebar .details {
        line-height: 1.2;
    }
    #usersidebar ul li {
        margin-bottom: 2px;
    }
}
`;
document.body.appendChild(styles);