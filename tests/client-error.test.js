// The client_error alert email. Its whole job is to be worth reading, so
// what it OMITS matters as much as what it says -- an alert channel that
// fires on every subway tunnel gets tuned out, which is how a real
// failure goes unnoticed.
const { makeSandbox, suite } = require('./lib/sandbox');

const base = {
  action: 'client_error', context: 'loadMember-stale', message: 'Load failed',
  extra: 'served from cache', customer_id: 'CUS-0010', screen: 'screen-status',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)',
};
const send = (over) => {
  const ctx = makeSandbox({ Settings: [] });
  ctx.getSettingValue = () => '';
  ctx.doClientError(Object.assign({}, base, over || {}));
  return ctx.__log.mails[0];
};

module.exports = () => suite('client_error: the alert email', (t) => {
  {
    const mail = send({ online: 'true' });
    t.ok('an email is sent', !!mail);
    t.ok('subject names the context', /loadMember-stale/.test(mail.subject));
    t.ok('body carries the message', mail.body.indexOf('Load failed') !== -1);
    t.ok('...the customer', mail.body.indexOf('CUS-0010') !== -1);
    t.ok('...the screen', mail.body.indexOf('screen-status') !== -1);
  }

  // The connectivity line is the one fact that decides whether an alert
  // is actionable at all, so all three states have to be distinguishable.
  {
    t.ok('online reports plainly',
      /Device online: yes/.test(send({ online: 'true' }).body));
    const off = send({ online: 'false' }).body;
    t.ok('offline says so', /Device online: NO/.test(off));
    t.ok('...and says it is probably not a fault', /not a fault/i.test(off));
    // A missing field must not read as "false" -- an older client that
    // does not send the field yet would otherwise look like a phone with
    // no signal, which is exactly the wrong conclusion.
    t.ok('a client that omits the field reads as unknown, NOT offline',
      /Device online: \(unknown\)/.test(send({}).body));
    t.ok('  ...and unknown is not mistaken for online',
      !/Device online: yes/.test(send({}).body));
  }

  // Rate limiting already existed; assert it still gates this path, since
  // the whole point of the change is keeping this channel readable.
  {
    const ctx = makeSandbox({ Settings: [] });
    ctx.getSettingValue = () => '';
    ctx.alertAllowed_ = () => false;
    ctx.doClientError(Object.assign({}, base, { online: 'true' }));
    t.eq('a rate-limited report sends no mail', ctx.__log.mails.length, 0);
  }
});
