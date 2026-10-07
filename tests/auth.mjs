import assert from 'node:assert/strict';
import {eligibleEmail,memberFromVerifiedUser,administratorEmails} from '../lib/access-policy.ts';
for(const email of administratorEmails)assert.equal(memberFromVerifiedUser({id:'test',email,email_confirmed_at:'2026-10-07'}).admin,true);
for(const email of ['coworker@cgi.com','coworker@cgifederal.com'])assert.equal(memberFromVerifiedUser({id:'test',email,email_confirmed_at:'2026-10-07'}).admin,false);
for(const email of ['outsider@gmail.com','teri.musick@cgi.com.evil.com','p@sub.cgi.com','a@@cgi.com','a b@cgi.com'])assert.equal(eligibleEmail(email),false);
assert.equal(memberFromVerifiedUser({id:'fake',email:'teri.musick@cgi.com'}),null);
assert.equal(memberFromVerifiedUser(null),null);
const a=memberFromVerifiedUser({id:'same-person',email:'Person@CGI.com',email_confirmed_at:'2026-10-07'}),b=memberFromVerifiedUser({id:'same-person',email:'changed@cgi.com',email_confirmed_at:'2026-10-07'});assert.equal(a.id,b.id);
console.log('PASS: four administrators, eligible domains, unverified-email rejection, voter permissions, stable account ID across email changes.');
