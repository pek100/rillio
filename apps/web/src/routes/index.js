// Copyright (C) 2017-2023 Smart code 203358507

const Addons = require('./Addons');
const Board = require('./Board');
const { default: Cached } = require('./Cached');
const Discover = require('./Discover');
const Library = require('./Library');
const Calendar = require('./Calendar').default;
const MetaDetails = require('./MetaDetails');
const NotFound = require('./NotFound');
const Search = require('./Search');
const { default: Settings } = require('./Settings');
const Player = require('./Player').default;
const Intro = require('./Intro');

module.exports = {
    Addons,
    Board,
    Cached,
    Discover,
    Library,
    Calendar,
    MetaDetails,
    NotFound,
    Search,
    Settings,
    Player,
    Intro
};
