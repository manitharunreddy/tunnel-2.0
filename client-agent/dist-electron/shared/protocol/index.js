"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageType = void 0;
var MessageType;
(function (MessageType) {
    MessageType["REGISTER"] = "REGISTER";
    MessageType["REGISTER_ACK"] = "REGISTER_ACK";
    MessageType["PING"] = "PING";
    MessageType["PONG"] = "PONG";
    MessageType["OPEN"] = "OPEN";
    MessageType["OPEN_ACK"] = "OPEN_ACK";
    MessageType["DATA"] = "DATA";
    MessageType["CLOSE"] = "CLOSE";
    MessageType["ERROR"] = "ERROR";
})(MessageType || (exports.MessageType = MessageType = {}));
