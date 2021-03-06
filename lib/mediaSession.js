var _ = require('underscore');
var bows = require('bows');
var JingleSession = require('./genericSession');
var JinglePeerConnection = require('jingle-rtcpeerconnection');


var log = bows('JingleMedia');


function MediaSession(opts) {
    JingleSession.call(this, opts);

    var self = this;

    this.pc = new JinglePeerConnection(this.parent.config.peerConnectionConfig,
                                       this.parent.config.peerConnectionConstraints);
    this.pc.on('ice', this.onIceCandidate.bind(this));
    this.pc.on('addStream', this.onStreamAdded.bind(this));
    this.pc.on('removeStream', this.onStreamRemoved.bind(this));
    this.pendingAnswer = null;

    if (this.parent.localStream) {
        this.pc.addStream(this.parent.localStream);
        this.localStream = this.parent.localStream;
    } else {
        this.parent.once('localStream', function (stream) {
            self.pc.addStream(stream);
            this.localStream = stream;
        });
    }

    this.stream = null;
}

MediaSession.prototype = Object.create(JingleSession.prototype, {
    constructor: {
        value: MediaSession
    }
});

MediaSession.prototype = _.extend(MediaSession.prototype, {
    start: function () {
        var self = this;
        this.state = 'pending';
        this.pc.isInitiator = true;
        this.pc.offer(function (err, sessDesc) {
            self.send('session-initiate', sessDesc.json);
        });
    },
    end: function (reason) {
        this.pc.close();
        this.onStreamRemoved();
        JingleSession.prototype.end.call(this, reason);
    },
    accept: function () {
        log(this.sid + ': Accepted incoming session');
        this.state = 'active';
        this.send('session-accept', this.pendingAnswer);
    },
    ring: function () {
        log(this.sid + ': Ringing on incoming session');
        this.send('session-info', {ringing: true});
    },
    mute: function (creator, name) {
        log(this.sid + ': Muting');
        this.send('session-info', {mute: {creator: creator, name: name}});
    },
    unmute: function (creator, name) {
        log(this.sid + ': Unmuting');
        this.send('session-info', {unmute: {creator: creator, name: name}});
    },
    hold: function () {
        log(this.sid + ': Placing on hold');
        this.send('session-info', {hold: true});
    },
    resume: function () {
        log(this.sid + ': Resuing from hold');
        this.send('session-info', {active: true});
    },
    onSessionInitiate: function (changes, cb) {
        log(this.sid + ': Initiating incoming session');
        var self = this;
        this.state = 'pending';
        this.pc.isInitiator = false;
        this.pc.answer({type: 'offer', json: changes}, function (err, answer) {
            if (err) {
                log(self.sid + ': Could not create WebRTC answer', err);
                return cb({condition: 'general-error'});
            }
            self.pendingAnswer = answer.json;
            cb();
        });
    },
    onSessionAccept: function (changes, cb) {
        var self = this;
        log(this.sid + ': Activating accepted outbound session');
        this.state = 'active';
        this.pc.handleAnswer({type: 'answer', json: changes}, function (err) {
            if (err) {
                log(self.sid + ': Could not process WebRTC answer', err);
                return cb({condition: 'general-error'});
            }

            self.parent.emit('accepted', self);
            cb();
        });
    },
    onSessionTerminate: function (changes, cb) {
        log(this.sid + ': Terminating session');
        this.pc.close();
        this.onStreamRemoved();
        JingleSession.prototype.end.call(this, changes.reason, true);
        cb();
    },
    onTransportInfo: function (changes, cb) {
        var self = this;
        log(this.sid + ': Adding ICE candidate');
        this.pc.processIce(changes, function (err) {
            if (err) {
                log(self.sid + ': Could not process ICE candidate', err);
            }
            cb();
        });
    },
    onSessionInfo: function (info, cb) {
        log(info);
        if (info.ringing) {
            log(this.sid + ': Ringing on remote stream');
            this.parent.emit('ringing', this);
        }

        if (info.hold) {
            log(this.sid + ': On hold');
            this.parent.emit('hold', this);
        }

        if (info.active) {
            log(this.sid + ': Resumed from hold');
            this.parent.emit('resumed', this);
        }

        if (info.mute) {
            log(this.sid + ': Muted', info.mute);
            this.parent.emit('mute', this, info.mute);
        }

        if (info.unmute) {
            log(this.sid + ': Unmuted', info.unmute);
            this.parent.emit('unmute', this, info.unmute);
        }

        cb();
    },
    onIceCandidate: function (candidateInfo) {
        log(this.sid + ': Discovered new ICE candidate', candidateInfo);
        this.send('transport-info', candidateInfo);
    },
    onStreamAdded: function (event) {
        if (this.stream) {
            log(this.sid + ': Received remote stream, but one already exists');
        } else {
            log(this.sid + ': Remote media stream added');
            this.stream = event.stream;
            this.parent.emit('peerStreamAdded', this);
        }
    },
    onStreamRemoved: function () {
        log(this.sid + ': Remote media stream removed');
        this.parent.emit('peerStreamRemoved', this);
    }
});


module.exports = MediaSession;
