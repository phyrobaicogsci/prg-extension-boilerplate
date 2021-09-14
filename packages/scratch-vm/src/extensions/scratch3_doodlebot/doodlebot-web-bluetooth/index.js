/*
* Doodlebot Web Bluetooth
* Built on top of 
* - micro:bit Web Bluetooth
* - Copyright (c) 2019 Rob Moran
*
* The MIT License (MIT)
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/
require("regenerator-runtime/runtime");
const UartService = require("./uart");

class Doodlebot {
    static async createService(services, serviceClass) {
        const found = services.find(service => service.uuid === "6e400001-b5a3-f393-e0a9-e50e24dcca9e"); // serviceClass.uuid);

        if (!found) {
            console.log("Service was not found")
            return undefined;
        }

        return await serviceClass.create(found);
    }

    static async requestRobot(bluetooth) {
        const device = await bluetooth.requestDevice({
            filters: [
                {
                    namePrefix: "BBC micro:bit" // "Bluefruit52"
                }
            ],
            optionalServices: [
                "6e400001-b5a3-f393-e0a9-e50e24dcca9e" // UartServices.uuid
            ]
        });

        return device;
    }

    static async getServices (device) {
        if (!device || !device.gatt) {
            return {};
        }

        if (!device.gatt.connected) {
            await device.gatt.connect();
        }

        const services = await device.gatt.getPrimaryServices();

        const uartService = await Doodlebot.createService(services, UartService);

        return {
            uartService
        };
    }
}
module.exports = Doodlebot;