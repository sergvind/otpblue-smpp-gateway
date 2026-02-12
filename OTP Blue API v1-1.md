# OTP Blue API v1.1

<aside>
🗺️

**Table of contents:**

</aside>

# 1. Sending OTP code

### POST request (preferred)

**POST** `https://api.otpblue.com/imsg/api/v1.1/otp/send/`

**Headers:**

```json
{
	"Authorization": "{API-Key}",
	"Content-Type": "application/json"
}
```

**Body:**

```json
{
    "contact": "+13231112233",
    "code": "111-222",
    "sender": "ClientName",
}
```

** The phone number in the contact parameter is just an example.*

### GET request

As an alternative, you can send requests as a GET request with query parameters:

**GET** `https://api.otpblue.com/imsg/api/v1.1/otp/send/?apikey={api_key}&contact=13231112233&code=111222&sender=ClientName`

### Parameters description

**`code`** - required parameter, max length - 10 characters.

**`sender`** - bold text before text, max length - 16 characters.

**`language`** - [ISO 639 language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) that is used in the template. Max length - 2 characters. If the specified language isn’t supported, English is used by default. See the [available languages section](https://www.notion.so/OTP-Blue-API-v1-1-2f8ded46b82f8057b700d0a0129bc51d?pvs=21) for details.

**Success response (status code 200) example:**

```json
{
    "message": "Request has been accepted and sent",
    "message_id": "ac5408f5-d311-4907-a31e-16699e83b1bc",
    "recipient": "+13231112233",
    "status": "delivered",
    "success": true
}
```

**Failed response (status code 400) example:**

```json
{
    "code": 150,
    "contact": "+13231112233",
    "message": "Recipient phone number +13231112233 does not support delivery through this channel",
    "status": "failed",
    "success": false
}
```

<aside>
👉

**HTTP 400 Bad Request**
If you receive an “HTTP 400 Bad Request” error response from our server, check the JSON response — it contains the details about the error.

For effective troubleshooting, please send us:

- destination phone number,
- error `code` and `message` from response
</aside>

### Error codes

**All error codes related to this API and webhooks:**

- `100` - Internal error/Bad request
- `110` - Unable to send message to Apple services
- **`150` - No iMessage**
*The most frequent reply (50% to 98%, depending on destination country)*
- `280` - This recipient has opted out of your messages
- **`720` - No capacity**
*Means we’re out of capacity at the moment and can’t deliver your message.*
- `1110` - Missed credentials
- `1155` - Unsupported phone number region for OTP codes
- `1160` - Invalid template language code for OTP code
- `1205` - Missed required parameters in JSON
- `1210` - Invalid OTP value
- `1215` - Invalid OTP code length
- `1220` - Invalid “sender” value
- `1225` - Sender value too long
- `1230` - Invalid “language” value
- `1250` - Invalid API Key
- `1600` - Invalid recipient
- `1800` - Invalid phone number
- `1900` - Phone number not mobile

# 2. Handle response

**Possible statuses:**

- `delivered`
- `failed`
OTP Blue doesn’t bill for failed messages.

**IP whitelisting**

The webhook IP range is dynamic, so we don’t recommend hardcoding our server’s IP address. To authenticate requests, you can include an [Authorization](https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Authorization) token (via the  (`status_callback_header` parameter) in the webhook, which you can then verify on your server.

## Message template

**Template example (EN)**

![1_1 thread (Light) 1.png](OTP%20Blue%20API%20v1%201/bc401158-2625-4893-ae12-5c030cda13e4.png)

Use `"language"` parameter to define the text message template. 

By default, `"en"` is used.

- **Available languages**
    - Bulgarian 🇧🇬 `bg`
    - Chinese (Chinese simplified) 🇨🇳🇭🇰🇹🇼🇸🇬 `zh`
    - Danish 🇩🇰 `da`
    - Dutch 🇳🇱🇧🇪 `nl`
    - English 🇺🇸🇬🇧🇨🇦🇦🇺🇳🇿🇮🇪 `en`
    - Finnish 🇫🇮 `fi`
    - French 🇫🇷 `fr`
    - German 🇩🇪🇦🇹 `de`
    - Icelandic 🇮🇸 `is`
    - Indonesian 🇮🇩 `in`
    - Italian 🇮🇹 `it`
    - Japanese 🇯🇵 `ja`
    - Korean 🇰🇷 `kr`
    - Malay 🇲🇾 `ms`
    - Norwegian 🇳🇴 `no`
    - Polish 🇵🇱 `pl`
    - Portuguese 🇵🇹🇧🇷 `pt`
    - Romanian 🇷🇴🇲🇩 `ro`
    - Russian 🇰🇿🇧🇾🇲🇩 `ru`
    - Spanish 🇪🇸🇲🇽 `es`
    - Swedish 🇸🇪 `sv`
    - Thai 🇹🇭 `en`
    - Turkish 🇹🇷 `tr`
    - Ukrainian 🇺🇦 `uk`
    - Vietnamese 🇻🇳 `vi`


# 3. Supported Destinations

iMessage works on iPhones in most global destinations. The most popular ones are available via API. If you need to send to a destination that is not on the list, please send us a request.

### 🌍 List of destinations, open by default

- **Africa**
    - 🇩🇿 Algeria
    - 🇦🇴 Angola
    - 🇨🇮 Côte d’Ivoire
    - 🇾🇪 Egypt
    - 🇪🇹 Ethiopia
    - 🇬🇭 Ghana
    - 🇬🇳 Guinea
    - 🇰🇪 Kenya
    - 🇲🇦 Morocco
    - 🇳🇬 Nigeria
    - 🇸🇳 Senegal
    - 🇿🇦 South Africa
    - 🇸🇾 Syria
- **Asia**
    - 🇦🇿 Azerbaijan
    - 🇦🇫 Afghanistan
    - 🇧🇩 Bangladesh
    - 🇰🇭 Cambodia
    - 🇬🇪 Georgia
    - 🇯🇵 Japan
    - 🇮🇩 Indonesia
    - 🇮🇷 Iran
    - 🇮🇶 Iraq
    - 🇮🇱 Israel
    - 🇰🇿 Kazakhstan
    - 🇰🇼 Kuwait
    - 🇰🇬 Kyrgyzstan
    - 🇱🇧 Lebanon
    - 🇲🇾 Malaysia
    - 🇲🇻 Maldives
    - 🇲🇳 Mongolia
    - 🇲🇲 Myanmar
    - 🇳🇵 Nepal
    - 🇵🇰 Pakistan
    - 🇵🇭 Philippines
    - 🇶🇦 Qatar
    - 🇷🇺 Russian Federation
    - 🇸🇦 Saudi Arabia
    - 🇸🇬 Singapore
    - 🇰🇷 South Korea
    - 🇱🇰 Sri Lanka
    - 🇦🇪 United Arab Emirates
    - 🇺🇿 Uzbekistan
    - 🇻🇳 Vietnam
- **Europe**
    - 🇦🇩 Andorra
    - 🇦🇲 Armenia
    - 🇦🇹 Austria
    - 🇧🇾 Belarus
    - 🇧🇪 Belgium
    - 🇧🇦 Bosnia & Herzegovina
    - 🇧🇬 Bulgaria
    - 🇩🇰 Denmark (inc. Faroe Islands)
    - 🇫🇷 France
    - 🇩🇪 Germany
    - 🇫🇮 Finland
    - 🇮🇸 Iceland
    - 🇮🇪 Ireland
    - 🇮🇹 Italy
    - 🇱🇮 Liechtenstein
    - 🇱🇺 Luxembourg
    - 🇲🇹 Malta
    - 🇲🇩 Moldova
    - 🇲🇨 Monaco
    - 🇳🇱 Netherland
    - 🇳🇴 Norway
    - 🇵🇱 Poland
    - 🇵🇹 Portugal
    - 🇷🇴 Romania
    - 🇸🇲 San Marino
    - 🇸🇮 Slovenia
    - 🇷🇸 Serbia
    - 🇪🇸 Spain
    - 🇸🇪 Sweden
    - 🇨🇭 Switzerland
    - 🇺🇦 Ukraine
    - 🇬🇧 United Kingdom (incl. Isle of Man, Jersey, Gibraltar, Cayman Islands, Turks And Caicos Islands)
- **Americas**
    - 🇧🇴 Bolivia
    - 🇨🇦 Canada
    - 🇨🇴 Colombia
    - 🇩🇴 Dominican Republic
    - 🇪🇨 Ecuador
    - 🇲🇽 Mexico
    - 🇵🇷 Puerto Rico
    - 🇺🇸 USA
- **Oceania**
    - 🇦🇺 Australia
    - 🇳🇿 New Zealand
    

### **Restricted countries**

We don’t send iMessage OTPs to 🇨🇳China and 🇦🇷Argentina due to local restrictions.

# 4. Testing and going live

The API key that we provide is live, so you can test real-world scenarios right away.

### **1) Send a test message to your own number**

- Check that iMessage is enabled and your number is registered:
    
    Settings > Apps > Messages > Send & Receive → ensure your phone number is ticked
    
    - Example
        
        ![imessage-active.png](OTP%20Blue%20API%20v1%201/imessage-active.png)
        
- Make sure your phone number country is within the [list on open destinations](https://www.notion.so/OTP-Blue-API-v1-1-2f8ded46b82f8057b700d0a0129bc51d?pvs=21). We can open additional destinations by your request.
- When testing on iPhone with iOS 26, some times you have check the iOS Spam folder
    - Details
        
        iOS 26 has introduced a Spam folder, with some SMS and iMessages ending up there. We see that with our clients ~1% of messages get in Spam.
        
        ### Spam folder
        
        ![spam1.png](OTP%20Blue%20API%20v1%201/spam1.png)
        
        ![spam2.png](OTP%20Blue%20API%20v1%201/spam2.png)
        
        ### OTP autosuggest
        
        Even if the message gets into Spam folder, the OTP autosuggest still works, and the conversion rate is high.
        
        ![autosuggest.png](OTP%20Blue%20API%20v1%201/autosuggest.png)
        
        <aside>
        👉
        
        OTP Blue clients report a conversion rate of 85% when delivering OTPs via iMessage.
        
        </aside>
        

<aside>
👉

**If you have any trouble receiving the test message, please send us:**

- destination phone number,
- webhook response that you receive from our server.
</aside>

### **2) Move on to client traffic**

Once you successfully receive the test message, you can begin testing on client traffic. 

<aside>
👉

**Conversion rate**

You should expect an 70%+ conversion rate for this channel.

</aside>

# 5. How-tos

## How to get requests history

Use this request to get your request history in a specific date frame

`GET` [https://api.otpblue.com/imsg/api/v1/otp/history/requests/?from_date=2025-11-01&to_date=2025-11-30&page=1&per_page=100](https://api.otpblue.com/imsg/api/v1/otp/history/requests/?from_date=2025-11-01&to_date=2025-11-30&page=1&per_page=1000)

Available query parameters:

- `from_date` - 2025-12-01, from which date need to fetch data
- `to_date` - 2025-12-31, to which date need to fetch data
- `page` - fetch items from a specific page
- `per_page` - items per page. Max value 1000.

**Example response:**

```json
{
	"count": 1,
	"items": [
	  {
	      "id": "92c08440-1795-4911-89c6-674403cbb147",
	      "create_date": "2025-11-30T23:29:59Z",
	      "region": "CI",
	      "contact": "+2250151944376",
	      "sender": "1xBet",
	      "status": "failed",
	      "text": "9797184",
	      "language": "en",
	      "error_code": 150
	  }
	],
	"num_pages": 1,
	"page": 1,
	"per_page": 1000
}
```

You can use `count` value to understand the total number of requests.

Item values:

- `attempt` - How many attempts were made to deliver the webhook
- `last_attempt_date` - Date of the last attempt to deliver webhook
- `id` or `webhook_id` - unique ID of this webhook, it’s unique for each specific `event + recipient`
- `json` - JSON body that contained the webhook

## How to check which regions are available for sending

`GET` [https://api.otpblue.com/imsg/api/v1/otp/available-regions/](https://api.otpblue.com/imsg/api/v1/otp/available-regions/)

**Example response:**

```json
{
	"regions": [
		{
      "name": "New Zealand",
      "code": "NZ"
    },
    {
      "name": "Australia",
      "code": "AU"
    },
    {
      "name": "United Kingdom",
      "code": "GB"
    },
    {
      "name": "Canada",
      "code": "CA"
    },
    {
      "name": "United States of America",
      "code": "US"
    }
	]
}
```