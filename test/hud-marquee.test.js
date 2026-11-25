const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');
const css = fs.readFileSync('desktop-app/overlay/overlay.css', 'utf8');

test('Repeated HUD layout checks do not restart an unchanged announcement', () => {
    const source = script.match(/const MARQUEE_GAP_PX[\s\S]*?function updateAnnouncementMarquee\(\) \{[\s\S]*?\r?\n\}/)?.[0];
    assert.ok(source);
    const classes = new Set();
    const properties = new Map();
    let starts = 0;
    let copies = [];
    let segmentWidth = 240;
    const segment = {
        getBoundingClientRect: () => ({ width: segmentWidth }),
        cloneNode: () => {
            const copy = { classList: { add() {} }, setAttribute() {}, remove() { copies = copies.filter(c => c !== copy); } };
            return copy;
        }
    };
    const text = {
        dataset: {},
        offsetWidth: 0,
        querySelector: () => segment,
        querySelectorAll: () => [...copies],
        appendChild: copy => copies.push(copy),
        classList: {
            add: name => { classes.add(name); starts++; },
            remove: name => classes.delete(name)
        },
        style: {
            setProperty: (name, value) => properties.set(name, value),
            removeProperty: name => properties.delete(name)
        }
    };
    const dom = {
        hudAnnouncement: { style: { display: 'flex' } },
        hudAnnouncementTrack: { clientWidth: 120 },
        hudAnnouncementText: text
    };
    const update = vm.runInNewContext(source + '; updateAnnouncementMarquee', { dom, Math });

    update();
    assert.equal(starts, 1);
    assert.equal(copies.length, 1);
    update();
    dom.hudAnnouncementTrack.clientWidth = 90;
    update();
    assert.equal(starts, 1, 'unchanged text must keep its running animation');
    assert.equal(copies.length, 1);

    segmentWidth = 70;
    update();
    assert.equal(classes.has('marquee-active'), false, 'short text no longer needs the marquee');
    assert.equal(copies.length, 0);
});

test('Announcement updates only when content changes, with a seamless loop and no endpoint pause', () => {
    assert.match(script, /if \(wasHidden \|\| dom\.hudAnnouncementText\.dataset\.annText !== annText\)/);
    assert.match(css, /animation: hudMarqueeLoop var\(--marquee-duration, 10s\) linear infinite/);
    assert.doesNotMatch(css, /0%, 15%|85%, 100%/);
});
