// Hand-authored from the persistence notes; no observed legacy sample files.
export const tournamentXml = `<?xml version="1.0" encoding="utf-8"?>
<Tournament>
  <Name>Evening &amp; Friends</Name><ID>X99-004213</ID>
  <TournamentStyleCode>01</TournamentStyleCode><StructureCode>01</StructureCode><EventTypeCode>01</EventTypeCode><PlayerStructure>01</PlayerStructure>
  <ReferenceDateTime>2003-01-02</ReferenceDateTime><Date>2026-11-16</Date><Time>18:30</Time>
  <CurrentRound>2</CurrentRound><TableOffset>6</TableOffset><PlayoffRound>0</PlayoffRound><SoftwareVersion>3.0.0.0</SoftwareVersion><Finalized>False</Finalized>
  <Staff><XmlStaffArray><XmlStaff><Player><ID>0000000099</ID><FirstName>Robin</FirstName><LastName>Judge</LastName><TeamPosition>0</TeamPosition></Player><XmlStaffPositionCode>05</XmlStaffPositionCode></XmlStaff></XmlStaffArray></Staff>
  <PenaltyList>
    <PlayerPenalty><Infraction>UnrecognizedMinor</Infraction><InfractionCode>08</InfractionCode><PenaltyCode>02</PenaltyCode><Player>0012345673</Player><Judge>0000000099</Judge><Round>1</Round><Notes>Checked &lt;cards&gt;</Notes></PlayerPenalty>
    <PlayerPenalty><Infraction>SlowPlayMinor</Infraction><Penalty>Warning</Penalty><Player>0000000002</Player><Judge>0</Judge><Round>2</Round><Notes/></PlayerPenalty>
  </PenaltyList>
  <Location><Id>00000000-0000-0000-0000-000000000001</Id><Name>Community Hall</Name><Address1>1 Main Street</Address1><City>Town</City></Location>
  <TournamentPlayers>
    <TournPlayer><Player><ID>0012345673</ID><FirstName>Ada</FirstName><LastName>Stone</LastName><TeamPosition>0</TeamPosition></Player><DropRound>0</DropRound><Rank>99</Rank><PlayoffPoints>80</PlayoffPoints><Wins>90</Wins><Points>999</Points><OpenDueling>0</OpenDueling><DropReason>Active</DropReason><AssignedSeat>7</AssignedSeat><Notes>Seat near door</Notes></TournPlayer>
    <TournPlayer><Player><ID>0000000002</ID><FirstName>Bea</FirstName><LastName>Reed</LastName><TeamPosition>0</TeamPosition></Player><DropRound>1</DropRound><Rank>1</Rank><Wins>90</Wins><Points>999</Points><DropReason>Drop</DropReason><AssignedSeat>0</AssignedSeat><Notes/></TournPlayer>
    <TournPlayer><Player><ID>9999000000</ID><FirstName>Cal</FirstName><LastName>Vale</LastName></Player><DropRound>0</DropRound><DropReason>Active</DropReason><AssignedSeat>0</AssignedSeat></TournPlayer>
  </TournamentPlayers>
  <Matches>
    <TournMatch><Player>0012345673</Player><Player>0000000002</Player><Round>0</Round><Status>Incomplete</Status><Table>1</Table><Winner>0</Winner><PlayoffMatch>False</PlayoffMatch></TournMatch>
    <TournMatch><Player>0012345673</Player><Player>0000000002</Player><Round>1</Round><Status>Winner</Status><Table>1</Table><Winner>0012345673</Winner><PlayoffMatch>False</PlayoffMatch></TournMatch>
    <TournMatch><Player>9999000000</Player><Player>0000000000</Player><Round>1</Round><Status>Winner</Status><Table>2</Table><Winner>9999000000</Winner><PlayoffMatch>False</PlayoffMatch></TournMatch>
    <TournMatch><Player>0012345673</Player><Player>9999000000</Player><Round>2</Round><Status>Draw</Status><Table>1</Table><Winner>0</Winner><PlayoffMatch>False</PlayoffMatch></TournMatch>
    <TournMatch><Player>0000000002</Player><Player>0000000000</Player><Round>2</Round><Status>Winner</Status><Table>2</Table><Winner>0</Winner><PlayoffMatch>False</PlayoffMatch></TournMatch>
    <TournMatch><Player>0000000042</Player><Player>0000000000</Player><Round>2</Round><Status>Winner</Status><Table>3</Table><Winner>42</Winner><PlayoffMatch>False</PlayoffMatch></TournMatch>
  </Matches>
</Tournament>`;

export const playerListXml = `<?xml version="1.0" encoding="utf-16"?>
<PlayerList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Player><FirstName>Ada &amp; Jo</FirstName><LastName>Stone</LastName><ID>0012345673</ID></Player>
  <Player><FirstName>Bea</FirstName><LastName>Reed</LastName><ID>2</ID></Player>
</PlayerList>`;
