/*globals _, Backbone  */
(function(){
	"use strict";

	var MAX_TOP_TAGS = 15,
		MAX_IMAGES = 6,
		IMAGE_SIZE = 125;

	var TAGS = ['frog', 'dalmatian', 'lion', 'plane', 'husky', 'cat', 'squirrel', 'bike', 'pigeon', 'gun', 'burger', 'sushi', 'coffee', 'snow', 'mouse', 'dragon', 'mud', 'kangaroo', 'chips', 'canoe', 'helicopter', 'waterfall'];
	TAGS = _.shuffle(TAGS);

	var EXCLUDE_TAGS = new RegExp('photooftheday|picoftheday|follow|instafamous|instafashion|friend|girl|boy|bieber');


	// Backbone base class with event functionality
	Backbone.Class = function(options) {
		this.cid = _.uniqueId('class');
		this.initialize.apply(this, arguments);
	};

	// Extend class prototype with Events
	_.extend(Backbone.Class.prototype, Backbone.Events, {
		initialize: function(){}
	});

	// Steal the reference to extend from Model because it's innaccessible from outside Backbone.js
	Backbone.Class.extend = Backbone.Model.extend;


	// ==================================================
	// GameRound
	// ==================================================
	var GameRound = Backbone.Model.extend({
		defaults: {
			'correctTag': null,
			'topTags': null,
			'images': null
		}
	});


	// ==================================================
	// MediaItem & MediaItemCollection
	// ==================================================
	var MediaItem = Backbone.Model.extend({});

	var MediaCollection = Backbone.Collection.extend({
		model: MediaItem,
		
		parse:function(response){
			return response.data;
		}
	});


	// ==================================================
	// GameRoundLoader
	// ==================================================
	var GameRoundLoader = Backbone.Class.extend({
		initialize: function() {
			// Media collection is reused for each round to fetch tag results
			this.mediaCollection = new MediaCollection();
		},

		loadRound: function(tag) {
			this.currentRoundIndex = new GameRound({
				correctTag: tag
			});

			this.mediaCollection.url = 'https://api.instagram.com/v1/tags/' + tag + '/media/recent?client_id=8639987a855746bd851bac3613887866';
			this.mediaCollection.fetch({
				dataType: 'jsonp',
				data:{count:64},
				success:_.bind(this.onLoadRoundSuccess, this),
				error: function() {
					console.log('Error loading media collection');
				}
			});
		},

		onLoadRoundSuccess: function() {
			this.currentRoundIndex.set('topTags', this.extractTopTags());
			this.currentRoundIndex.set('images', this.extractTopImages());
			this.trigger('roundLoaded', this.currentRoundIndex);
		},

		extractTopTags: function() {
			// Build a dictionary mapping tags to their frequency in the following format:
			// {'cat': {count: 5, tag: 'cats'}, 'dog': {count: 7, tag: 'dog'}}
			var tagFrequenciesMap = {};
			this.mediaCollection.each(function(mediaItem) {
				_.each(mediaItem.get('tags'), function(tag) {
					if (tagFrequenciesMap[tag]) {
						tagFrequenciesMap[tag].count++;
					} else {
						tagFrequenciesMap[tag] = {tag: tag, count: 1};
					}
				}, this);
			}, this);

			// Reduce the tags down to the top frequencies and put them in a flat array
			var topTags = _.chain(tagFrequenciesMap)
				.toArray()
				.reject(function(item) {
					return EXCLUDE_TAGS.test(item.tag);
				})
				.sortBy('count')
				.reverse()
				.first(MAX_TOP_TAGS)
				.pluck('tag')
				.value();

			return topTags;
		},

		extractTopImages: function() {
			// Build a simple array containing objects of image urls and like counts, eg:
			// [{url: 'asdf', likes: 12}, {url: 'qwer', likes: 5}]
			var likedImages = [];
			this.mediaCollection.each(function(mediaItem) {
				var rejectItem = false;
				_.each(mediaItem.get('tags'), function(tag) {
					if (EXCLUDE_TAGS.test(tag)) {
						rejectItem = true;
					}
				});
				if (!rejectItem) {
					likedImages.push({
						// A recurring bug in the api means the url sometimes comes back on the wrong object
						url: mediaItem.get('images').thumbnail.url || mediaItem.get('images').thumbnail,
						likes: mediaItem.get('likes').count
					});
				}
			}, this);

			// Reduce down to the most liked images
			likedImages = _.chain(likedImages)
				// NOTE: high like counts don't seem to equate to a good photo of the tag...
				// .sortBy('likes')
				// .reverse()
				.first(MAX_IMAGES)
				.pluck('url')
				.value();

			return likedImages;
		}
	});


	// ==================================================
	// ImageView
	// ==================================================
	var ImageView = Backbone.View.extend({
		initialize: function() {
			// The card that's flipped over
			this.card = this.$('.card');
			this.points = this.$('.image-points');
			this.points.css({opacity: 0});
		},

		setImage: function(url) {
			this.$('.back .image-holder').html('<img src="' + url + '">');
			this.points.css({opacity: 0});
		},

		show: function(delay) {
			_.delay(_.bind(function() {
				this.card.addClass('flipped');
			}, this), delay || 0);
		},

		hide: function(delay) {
			_.delay(_.bind(function() {
				this.card.removeClass('flipped');
			}, this), delay || 0);
		},

		showPoints: function(delay) {
			_.delay(_.bind(function() {
				// Show the little image points banner below the image
				this.$('.image-points')
					.delay(250)
					.css({top:IMAGE_SIZE - 23, opacity: 1})
					.show()
					.animate({top:IMAGE_SIZE}, 450, 'easeOutBounce');
				this.show();
			}, this), delay || 0);
		}
	});

	
	// ==================================================
	// ImageRevealerView
	// ==================================================
	var ImageRevealerView = Backbone.View.extend({
		initialize: function() {
			this.template = _.template($('#template-image-view').html());
			this.render();

			// Create all the image views using the elements just added in render
			this.imageViews = [];
			this.$('.image').each(_.bind(function(index, elem) {
				var imageView = new ImageView({
					el: $(elem)
				});
				this.imageViews.push(imageView);
			}, this));
		},

		// Only called once in initialized(), the image views are subsequently recycled
		render: function() {
			this.$el.html(this.template({totalImages: MAX_IMAGES}));
		},

		setNewImages: function(images) {
			this.currentImageIndex = -1;
			this.totalImages = images.length;

			// Loop over each ImageView and set it's new image
			_.each(this.imageViews, function(imageView, index) {
				imageView.setImage(images[index]);
			}, this);
		},

		hasNextImage: function() {
			return this.currentImageIndex < this.totalImages - 1;
		},

		showNextImage: function() {
			if (this.hasNextImage()) {
				this.currentImageIndex++;
				this.imageViews[this.currentImageIndex].show();
			}
		},

		getTotalRemainingImages: function() {
			return this.totalImages - this.currentImageIndex - 1;
		},

		showRemainingImages: function() {
			for (var i = 0; i < this.getTotalRemainingImages(); i++) {
				this.imageViews[i + this.currentImageIndex + 1].show(i * 80);
			}
		},

		hideAll: function() {
			_.each(this.imageViews, function(imageView, index) {
				imageView.hide(index * 80);
			}, this);
		},

		showRemainingPoints: function() {
			for (var i = 0; i < this.getTotalRemainingImages(); i++) {
				this.imageViews[i + this.currentImageIndex + 1].showPoints(i * 80);
			}
		}
	});


	// ==================================================
	// FeedbackView
	// ==================================================
	var FeedbackView = Backbone.View.extend({
		initialize: function() {
			this.label = this.$('span');
		},

		showGo: function() {
			this.label.html('GO!').css({color: '#de4491'});
			this.flashFeedback();
		},

		showCorrect: function(score) {
			this.label.html('CORRECT! 50 PTS').css({color: '#de4491'});
			this.flashFeedback();
		},

		showClose: function() {
			this.label.html('CLOSE - TRY AGAIN').css({color: '#e7813d'});
			this.flashFeedback();
		},

		showWrong: function() {
			this.label.html('WRONG - TRY AGAIN').css({color: '#c54141'});
			this.flashFeedback();
		},

		showGameOver: function(correctTag) {
			this.label.html('FAILED \'' + correctTag + '\'').css({color: '#c54141'});
			this.flashFeedback();
		},

		showSkip: function(correctTag) {
			this.label.html('SKIPPING \'' + correctTag + '\'').css({color: '#333'});
			this.flashFeedback();
		},

		hide: function() {
			this.label.stop(true).animate({opacity: 0}, 80);
		},

		flashFeedback: function() {
			this.label.stop(true)
				.animate({opacity: 0}, 80)
				.animate({opacity: 1}, 80)
				.animate({opacity: 0}, 80)
				.animate({opacity: 1}, 80);
		}
	});


	// ==================================================
	// LoaderView
	// ==================================================
	var LoaderView = Backbone.View.extend({
		initialize: function() {
			// this.$el.hide();
		},

		show: function() {
			if (this.shownOnce) {
				this.$('span').html('Loading next round...');
			}
			this.$el.fadeIn();
			this.shownOnce = true;
		},

		hide: function() {
			this.$el.fadeOut();
		}
	});


	// ==================================================
	// ScoreView
	// ==================================================
	var ScoreView = Backbone.View.extend({
		initialize: function() {
			this.pointsLabel = this.$('.points');
			this.roundPoints = this.$('#round-points');
			this.roundPoints.hide();
		},

		updateScore: function(oldPoints, newPoints) {
			var diffPoints = newPoints - oldPoints;
			this.roundPoints.html('+' + diffPoints + 'pts');

			this.roundPoints.fadeIn().delay(1000).fadeOut();

			$({counter: oldPoints}).animate({counter: newPoints}, {duration: 1200, easing: 'linear', step: _.bind(function(value) {
				this.pointsLabel.html(Math.round(value));
			}, this)});
		}
	});


	// ==================================================
	// GameView
	// ==================================================
	var GameView = Backbone.View.extend({

		initialize:function(){
			this.gameRoundLoader = new GameRoundLoader();
			this.gameRoundLoader.on('roundLoaded', this.onRoundLoaded, this);

			this.scoreView = new ScoreView({el: this.$('#score')});
			this.imageRevealerView = new ImageRevealerView({el: this.$('#image-revealer')});
			this.feedbackView = new FeedbackView({el: this.$('#feedback')});
			this.loaderView = new LoaderView({el: this.$('#loader')});

			this.currentRoundIndex = -1;
			this.currentRound = null;

			this.currentScore = 0;
		},

		nextRound: function() {
			this.disableUserInput();
			this.$('#guess input').val(''); // Clear input text
			this.loaderView.show();
			this.feedbackView.hide();
			this.imageRevealerView.hideAll();

			// Give the images time to flip back to the front
			_.delay(_.bind(this.loadRound, this), 500);
		},

		loadRound: function() {
			// Loop tags forever
			this.currentRoundIndex++;
			this.gameRoundLoader.loadRound(TAGS[this.currentRoundIndex % TAGS.length]);
		},

		onRoundLoaded: function(round) {
			this.currentRound = round;
			this.imageRevealerView.setNewImages(round.get('images'));
			_.delay(_.bind(this.startRound, this), 1500);
		},

		startRound: function() {
			this.loaderView.hide();

			// Enable user input
			this.$('#guess button').prop('disabled', false);
			this.$('#guess input').val('').prop('disabled', false).focus().select();
			this.$('#round .points').html(this.currentRoundIndex + 1);
			_.delay(_.bind(this.feedbackView.showGo, this.feedbackView), 250);

			this.imageRevealerView.showNextImage();
		},

		checkGuess: function(guess) {
			// Sanitise input
			guess = $.trim(guess).toLowerCase();

			if (guess !== '') {
				if (guess === this.currentRound.get('correctTag')) {
					// Correct guess
					var score = this.imageRevealerView.getTotalRemainingImages() * 20 + 50;
					var previousScore = this.currentScore;
					this.currentScore += score;
					this.feedbackView.showCorrect();
					this.imageRevealerView.showRemainingPoints();
					this.disableUserInput();
					_.delay(_.bind(this.scoreView.updateScore, this.scoreView), 900, previousScore, this.currentScore);

					_.delay(_.bind(this.nextRound, this), 2500);

				} else {
					// Incorrect guess
					if (this.currentRound.get('topTags').indexOf(guess) !== -1) {
						this.feedbackView.showClose();
					} else {
						this.feedbackView.showWrong();
					}

					// Check if there's another image in this round
					if (this.imageRevealerView.hasNextImage()) {
						// Reselect the text in the input box for another go
						$('#guess input').focus().select();
						$('#guess input').get(0).setSelectionRange(0, 9999); // mobile safari
						this.imageRevealerView.showNextImage();
					} else {
						this.feedbackView.showGameOver(this.currentRound.get('correctTag'));
						this.disableUserInput();
						_.delay(_.bind(this.nextRound, this), 2000);
					}
				}
			}
		},

		disableUserInput: function() {
			this.$('#guess input').prop('disabled', true);
			this.$('#guess button').blur().prop('disabled', true);
		},

		events: {
			'keyup #guess input': 'onGuessInputKeyup',
			'click #guess button': 'onSkipRoundButtonClick'
		},

		onGuessInputKeyup: function(event) {
			if (event.keyCode === 13) {
				this.checkGuess($(event.target).val());
			}
		},

		onSkipRoundButtonClick: function(event) {
			this.disableUserInput();
			this.feedbackView.showSkip(this.currentRound.get('correctTag'));
			this.imageRevealerView.showRemainingImages();
			_.delay(_.bind(this.nextRound, this), 2000);
		}

	});

	$(function() {
		var gameView = new GameView({el: $('#game')});
		gameView.nextRound();
	});
	
})();
