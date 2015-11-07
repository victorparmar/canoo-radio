// var request = require('supertest');
var request = require("supertest-as-promised");
var expect = require("chai").expect;
var Chance = require('chance'),
    chance = new Chance();

var radio = require('../radio');


describe("radio", function() {

  var app_url = 'http://localhost:8000';

  /*
  beforeEach(function (done) {
    radio.init();
    done();
  });

  afterEach(function (done) {
    radio.destroy();
    done();
  });
  */

  before(function (done) {
    radio.init();
    done();
  });

  after(function (done) {
    radio.destroy();
    done();
  });

  var routePlaylist = '/api/playlist';
  var routeUser = '/api/user';
  var routePlayer = '/api/player';
  var routeVote = '/api/vote';
  var routeMusicDb = '/api/music';

  /**
   * helper which returns a promise on /playlist/add
   */
  var addSong = function (filename, userId, httpCode) {

    return request(app_url)
      .get(routePlaylist + '/add?filename=' + filename + '&userId=' + userId)
      .expect(httpCode)
      .then(function (res) {
        return res.body;
      });
  };

  /**
   * helper which returns a promise on /user/:id
   */
  var getUser = function (userId, httpCode) {

    return request(app_url)
      .get(routeUser + '/' + userId)
      .expect(httpCode)
      .then(function (res) {
        return res.body;
      });
  };


  /**
   * helper which returns a promise on /playlist/upcoming
   */
  var getUpcomingSongs = function () {
    return request(app_url)
      .get(routePlaylist + '/upcoming')
      .expect(200)
      .then(function (res) {
        // console.log(res.body);
        return res.body;
      });
  };


  //
  // tests
  //

  describe(routePlaylist, function () {

    it('should get the current song', function () {

      return request(app_url)
        .get(routePlaylist + '/current')
        .expect(200)
        .then(function (res) {
          console.log(res.body);
        });
    });

    it('should get played songs', function () {

      return request(app_url)
        .get(routePlaylist + '/played')
        .expect(200)
        .then(function (res) {
          console.log(res.body);
        });
    });

    it('should get upcoming songs', function () {
      return getUpcomingSongs();
    });

  });

  describe(routeUser, function () {

    it('should get a user', function () {

      return getUser('random', 200)
        .then(function (user) {
          expect(user._id).to.equal('random');
          expect(user.id).to.equal('random');
          expect(user.votes).not.to.be.null;
        });
    });

  });

  describe(routePlayer, function () {

    it('should play the next song', function () {

      return request(app_url)
        .get(routeUser + '/next')
        .expect(200)
        .then(function (res) {
          // nothing
        });

    });

  });

  describe(routeMusicDb, function () {

    it('should get a random selection of songs', function () {

      return request(app_url)
        .get(routeMusicDb + '/random?limit=2')
        .expect(200)
        .then(function (res) {
          var songs = res.body;
          expect(songs.length).to.equal(2);
        });
    });

    it('should get top charts', function () {

      return request(app_url)
        .get(routeMusicDb + '/charts?limit=2')
        .expect(200)
        .then(function (res) {
          var songs = res.body;
          expect(songs.length).to.equal(2);
        });
    });

  });

  describe(routeVote, function () {

    it('should upvote for a song', function () {

      return request(app_url)
        .get(routeVote + '/up?filename=snoop.mp3&userId=ignoramus')
        .expect(200)
        .then(function (res) {

        });

    });

  });


  describe("scenarios", function () {

    it('should add a vote and get a user', function () {

      var userId = chance.string({length: 8, pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'});
      var filename = 'file.mp3';

      return getUser(userId, 200)
        .then(function (user) {
          return request(app_url)
            .get(routeVote + '/up?filename=' + filename + '&userId=' + userId)
            .expect(200)
            .then(function (res) {
              return res.body;
            });
        })
        .then(function () {
          return getUser(userId, 200);
        })
        .then(function (user) {
          console.log(user);
          expect(user.votes[filename]).to.equal(1);
        });

    });

    it('should add a song when there is nothing in the queue', function () {

      var userId = chance.string({length: 8, pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'});
      var filename = 'file.mp3';

      return getUser(userId, 200)
        .then(function (user) {
          return addSong(filename, userId, 200);
        })
        .then(function () {
          return getUpcomingSongs();
        })
        .then(function (upcoming) {
          // console.log(upcoming);
          expect(upcoming.length).to.equal(6);
        })
        .then(function () {
          return getUser(userId, 200);
        })
        .then(function (user) {
          console.log(user);
          expect(user.queue.length).to.equal(1);
        });

    });

    it('should not add a song to the playlist when it is already in there', function () {

      var userId = chance.string({length: 8, pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'});
      var filename = 'e.mp3';

      return getUser(userId, 200)
        .then(function (user) {
          return addSong(filename, userId, 200);
        })
        .then(function () {
          return getUpcomingSongs();
        })
        .then(function (upcoming) {
          // console.log(upcoming);
          expect(upcoming.length).to.equal(6); // note existence of file.mp3 from previous test
        })
        .then(function () {
          return getUser(userId, 200);
        })
        .then(function (user) {
          console.log(user);
          expect(user.queue.length).to.equal(1);
        });

    });

    it('should return 403 if user queue limit reached', function () {

      var userId = chance.string({length: 8, pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'});
      var files = ['1.mp3', '2.mp3', '3.mp3', '4.mp3'];

      return getUser(userId, 200)
        .then(function (user) {
          return addSong(files[0], userId, 200);
        })
        .then(function () {
          return addSong(files[1], userId, 200);
        })
        .then(function () {
          return addSong(files[2], userId, 200);
        })
        .then(function () {
          return addSong(files[3], userId, 403);
        });

    });

  });

});
